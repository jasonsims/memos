import { useQueryClient } from "@tanstack/react-query";
import { type RefObject, useCallback } from "react";
import { toast } from "react-hot-toast";
import { useNewMemo } from "@/contexts/NewMemoContext";
import { attachmentKeys } from "@/hooks/useAttachmentQueries";
import { memoKeys } from "@/hooks/useMemoQueries";
import { userKeys } from "@/hooks/useUserQueries";
import { getErrorTrackProperties, handleError } from "@/lib/error";
import { getComposerSource, type PendoTrackProperties, trackPendoEvent } from "@/lib/pendo";
import type { Attachment } from "@/types/proto/api/attachment_service_pb";
import { Visibility } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { extractMentionUsernames } from "@/utils/mention-extraction";
import { errorService, memoService, validationService } from "../services";
import { type EditorState, useEditorContext } from "../state";
import type { EditorController } from "../types/editorController";
import { restampDefaultCreateTime } from "../utils/deriveDefaultCreateTime";

/** How long a closing host shows "Saved" before it unmounts the editor. */
const SAVED_CONFIRMATION_MS = 900;

/** What a save sent, for track events: sizes and counts only, never the content. */
const getSavedContentProperties = (state: EditorState, uploadedCount: number): PendoTrackProperties => ({
  visibility: Visibility[state.metadata.visibility],
  content_length: state.content.length,
  attachment_count: state.metadata.attachments.length + uploadedCount,
  uploaded_file_count: uploadedCount,
  relation_count: state.metadata.relations.length,
  has_location: Boolean(state.metadata.location),
});

interface UseMemoSaveOptions {
  memoName?: string;
  parentMemoName?: string;
  defaultSpace?: string;
  defaultVisibility?: Visibility;
  defaultCreateTime?: Date;
  /** The editor's draft cache key, which names the composer in track events. */
  cacheKey?: string;
  /** Reads the saved document's tags and checklist for track events. */
  editorRef?: RefObject<EditorController | null>;
  discardDraft: () => void;
  onConfirm?: (memoName: string) => void;
  onCancel?: () => void;
}

/**
 * Owns the editor's save transaction and its post-save cache/state updates.
 * Keeping this workflow outside the shell makes saving identical whether it is
 * triggered by the toolbar or the editor keyboard shortcut.
 */
export function useMemoSave({
  memoName,
  parentMemoName,
  defaultSpace,
  defaultVisibility,
  defaultCreateTime,
  cacheKey,
  editorRef,
  discardDraft,
  onConfirm,
  onCancel,
}: UseMemoSaveOptions): () => Promise<void> {
  const t = useTranslate();
  const queryClient = useQueryClient();
  const { markNewMemo } = useNewMemo();
  const { actions, dispatch, getState } = useEditorContext();

  return useCallback(async () => {
    const state = getState();
    // A repeated shortcut during the saved confirmation is not an error worth
    // a toast; the save already landed and the host is closing.
    if (state.ui.justSaved) return;
    const { valid, reason, detail } = validationService.canSave(state);
    if (!valid) {
      toast.error(reason ? t(reason, detail ? { url: detail } : undefined) : t("editor.validation.cannot-save"));
      return;
    }

    dispatch(actions.setLoading("saving", true));

    // Files that finished uploading, keyed by preview URL. If the save fails
    // after they uploaded, they move onto the draft as attachments so that a
    // retry does not upload them again (a refused create would otherwise leak
    // one copy per attempt into the user's storage).
    const uploaded = new Map<string, Attachment>();
    const keepUploadedFiles = () => {
      if (uploaded.size === 0) return;
      const current = getState();
      const moved = current.localFiles.filter((file) => uploaded.has(file.previewUrl));
      if (moved.length === 0) return;
      dispatch(
        actions.setMetadata({
          attachments: [...current.metadata.attachments, ...moved.map((file) => uploaded.get(file.previewUrl) as Attachment)],
        }),
      );
      dispatch(actions.setLocalFiles(current.localFiles.filter((file) => !uploaded.has(file.previewUrl))));
    };

    try {
      // A new memo composed on a selected day keeps the day but is stamped with
      // the time of saving, so consecutive memos do not share one createTime.
      const now = new Date();
      const timestamps = memoName
        ? state.timestamps
        : {
            createTime: restampDefaultCreateTime(state.timestamps.createTime, defaultCreateTime, now),
            updateTime: restampDefaultCreateTime(state.timestamps.updateTime, defaultCreateTime, now),
          };
      const result = await memoService.save(
        { ...state, timestamps },
        {
          memoName,
          parentMemoName,
          space: defaultSpace,
          onFileUploaded: (file, attachment) => uploaded.set(file.previewUrl, attachment),
        },
      );

      if (!result.hasChanges) {
        toast.error(t("editor.no-changes-detected"));
        onCancel?.();
        return;
      }

      // Sent before the editor resets, while it still holds the saved document.
      if (memoName) {
        trackPendoEvent("memo_updated", () => ({
          ...getSavedContentProperties(state, uploaded.size),
          changed_fields: result.updateMask,
          moved_space: Boolean(result.moved),
          is_comment: Boolean(parentMemoName),
          composer_source: getComposerSource(cacheKey),
        }));
      } else if (parentMemoName) {
        trackPendoEvent("memo_comment_created", () => ({
          ...getSavedContentProperties(state, uploaded.size),
          parent_memo_name: parentMemoName,
          mention_count: extractMentionUsernames(state.content).length,
        }));
      } else {
        trackPendoEvent("memo_created", () => ({
          ...getSavedContentProperties(state, uploaded.size),
          composer_source: getComposerSource(cacheKey),
          has_space: Boolean(defaultSpace ?? state.metadata.space),
          has_custom_create_time: Boolean(timestamps.createTime),
          tag_count: editorRef?.current?.getTags().length,
          mention_count: extractMentionUsernames(state.content).length,
          has_checklist: editorRef?.current?.hasChecklist(),
          accepted_suggestion_count: state.acceptedSuggestionIds.length,
          is_focus_mode: state.ui.isFocusMode,
        }));
      }

      // Prevent the autosave unmount flush from restoring the saved draft.
      discardDraft();
      // A moved memo may leave the feed it was edited in; say where it went.
      if (result.moved) {
        toast.success(t("memo.moved"));
      }

      const invalidationPromises: Promise<unknown>[] = [
        queryClient.invalidateQueries({ queryKey: memoKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: userKeys.stats() }),
        queryClient.invalidateQueries({ queryKey: attachmentKeys.lists() }),
      ];
      if (memoName) {
        invalidationPromises.push(queryClient.invalidateQueries({ queryKey: memoKeys.detail(memoName) }));
      }
      if (parentMemoName) {
        invalidationPromises.push(queryClient.invalidateQueries({ queryKey: memoKeys.comments(parentMemoName) }));
        invalidationPromises.push(queryClient.invalidateQueries({ queryKey: memoKeys.detail(parentMemoName) }));
      }
      // Hosts that close after saving (edit, comment) hold a brief "Saved"
      // confirmation on the toolbar while the caches refresh underneath. The
      // in-place composer clears immediately, so it shows nothing.
      if (memoName || parentMemoName) {
        dispatch(actions.setLoading("saving", false));
        dispatch(actions.setJustSaved(true));
        invalidationPromises.push(new Promise((resolve) => setTimeout(resolve, SAVED_CONFIRMATION_MS)));
      }
      await Promise.all(invalidationPromises);

      dispatch(actions.reset());
      if (!memoName && defaultVisibility) {
        dispatch(actions.setMetadata({ visibility: defaultVisibility }));
      }
      // Reset creates a fresh editor state, so restore calendar-derived values
      // for the next memo created without remounting this composer.
      if (!memoName && defaultCreateTime) {
        dispatch(actions.setTimestamps({ createTime: defaultCreateTime, updateTime: defaultCreateTime }));
      }

      if (!memoName && !parentMemoName) {
        markNewMemo(result.memoName);
      } else if (memoName) {
        markNewMemo((currentName) => (currentName === memoName ? null : currentName));
      }
      onConfirm?.(result.memoName);
    } catch (error) {
      keepUploadedFiles();
      trackPendoEvent("memo_save_failed", () => {
        const { error_reason, error_code, quota_metric } = getErrorTrackProperties(error);
        return {
          operation: memoName ? "update" : parentMemoName ? "comment" : "create",
          error_reason,
          quota_metric,
          error_code,
          uploaded_file_count: uploaded.size,
          pending_local_file_count: state.localFiles.length - uploaded.size,
          content_length: state.content.length,
          composer_source: getComposerSource(cacheKey),
        };
      });
      if (uploaded.size > 0) {
        // The uploads landed even though the save did not.
        void queryClient.invalidateQueries({ queryKey: attachmentKeys.lists() });
        void queryClient.invalidateQueries({ queryKey: userKeys.stats() });
      }
      handleError(error, toast.error, {
        context: "Failed to save memo",
        fallbackMessage: errorService.getErrorMessage(error),
      });
    } finally {
      dispatch(actions.setLoading("saving", false));
      dispatch(actions.setJustSaved(false));
    }
  }, [
    actions,
    cacheKey,
    defaultCreateTime,
    defaultSpace,
    defaultVisibility,
    discardDraft,
    dispatch,
    editorRef,
    getState,
    markNewMemo,
    memoName,
    onCancel,
    onConfirm,
    parentMemoName,
    queryClient,
    t,
  ]);
}
