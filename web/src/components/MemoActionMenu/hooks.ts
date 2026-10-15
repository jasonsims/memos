import { useQueryClient } from "@tanstack/react-query";
import copy from "copy-to-clipboard";
import { useCallback } from "react";
import toast from "react-hot-toast";
import { useLocation } from "react-router-dom";
import { useInstance } from "@/contexts/InstanceContext";
import { memoKeys, useDeleteMemo, useUpdateMemo } from "@/hooks/useMemoQueries";
import useNavigateTo from "@/hooks/useNavigateTo";
import { userKeys } from "@/hooks/useUserQueries";
import { handleError } from "@/lib/error";
import { getMemoTrackProperties, trackPendoEvent } from "@/lib/pendo";
import { extractMemoIdFromName } from "@/lib/resource-names";
import { ROUTES } from "@/router/routes";
import { State } from "@/types/proto/api/common_pb";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { extractTasks } from "@/utils/markdown-manipulation";
import { checkAllTasks, uncheckAllTasks } from "@/utils/markdown-task-actions";
import { isMemoDetailPath } from "../MemoView/navigation";

interface UseMemoActionHandlersOptions {
  memo: Memo;
  parentPage?: string;
  onEdit?: () => void;
  setDeleteDialogOpen: (open: boolean) => void;
}

export const useMemoActionHandlers = ({ memo, parentPage, onEdit, setDeleteDialogOpen }: UseMemoActionHandlersOptions) => {
  const t = useTranslate();
  const location = useLocation();
  const navigateTo = useNavigateTo();
  const queryClient = useQueryClient();
  const { profile } = useInstance();
  const { mutateAsync: updateMemo } = useUpdateMemo();
  const { mutateAsync: deleteMemo } = useDeleteMemo();
  const isInMemoDetailPage = isMemoDetailPath(location.pathname, memo.name);

  const memoUpdatedCallback = useCallback(() => {
    // Invalidate user stats to trigger refetch
    queryClient.invalidateQueries({ queryKey: userKeys.stats() });
  }, [queryClient]);

  const updateMemoContent = useCallback(
    async (nextContent: string, context: string, action: "check_all" | "uncheck_all") => {
      if (nextContent === memo.content) {
        return;
      }

      try {
        await updateMemo({
          update: {
            name: memo.name,
            content: nextContent,
          },
          updateMask: ["content", "update_time"],
        });
        trackPendoEvent("memo_tasks_bulk_toggled", () => ({
          ...getMemoTrackProperties(memo),
          action,
          tasks_changed_count: extractTasks(memo.content).filter((task) => task.checked !== (action === "check_all")).length,
        }));
        toast.success(t("memo.task-actions.updated"));
      } catch (error: unknown) {
        handleError(error, toast.error, {
          context,
          fallbackMessage: "An error occurred",
        });
      }
    },
    [memo, t, updateMemo],
  );

  const handleTogglePinMemoBtnClick = useCallback(async () => {
    try {
      await updateMemo({
        update: {
          name: memo.name,
          pinned: !memo.pinned,
        },
        updateMask: ["pinned"],
      });
      trackPendoEvent("memo_pin_toggled", () => ({
        ...getMemoTrackProperties(memo),
        pinned: !memo.pinned,
        from_detail_page: isInMemoDetailPage,
      }));
    } catch {
      // do nothing
    }
  }, [isInMemoDetailPage, memo, updateMemo]);

  const handleEditMemoClick = useCallback(() => {
    onEdit?.();
  }, [onEdit]);

  const handleToggleMemoStatusClick = useCallback(async () => {
    const isArchiving = memo.state !== State.ARCHIVED;
    const state = memo.state === State.ARCHIVED ? State.NORMAL : State.ARCHIVED;
    const message = memo.state === State.ARCHIVED ? t("message.restored-successfully") : t("message.archived-successfully");

    try {
      await updateMemo({
        update: {
          name: memo.name,
          state,
        },
        updateMask: ["state"],
      });
      trackPendoEvent("memo_archive_state_changed", () => ({
        ...getMemoTrackProperties(memo),
        new_state: State[state],
        from_detail_page: isInMemoDetailPage,
        was_pinned: memo.pinned,
      }));
      toast.success(message);
    } catch (error: unknown) {
      handleError(error, toast.error, {
        context: `${isArchiving ? "Archive" : "Restore"} memo`,
        fallbackMessage: "An error occurred",
      });
      return;
    }

    if (isInMemoDetailPage) {
      navigateTo(memo.state === State.ARCHIVED ? ROUTES.HOME : ROUTES.ARCHIVED);
    }
    memoUpdatedCallback();
  }, [memo, t, isInMemoDetailPage, navigateTo, memoUpdatedCallback, updateMemo]);

  const handleCopyLink = useCallback(() => {
    let host = profile.instanceUrl;
    if (host === "") {
      host = window.location.origin;
    }
    // A comment's link lands on the comment inside its parent memo, as the comment previews do.
    const path = memo.parent ? `${memo.parent}#${extractMemoIdFromName(memo.name)}` : memo.name;
    copy(`${host}/${path}`);
    toast.success(t("message.succeed-copy-link"));
  }, [memo.name, memo.parent, t, profile.instanceUrl]);

  const handleCopyContent = useCallback(() => {
    copy(memo.content);
    toast.success(t("message.succeed-copy-content"));
  }, [memo.content, t]);

  const handleCheckAllTaskListItemsClick = useCallback(async () => {
    await updateMemoContent(checkAllTasks(memo.content), "Check memo task list items", "check_all");
  }, [memo.content, updateMemoContent]);

  const handleUncheckAllTaskListItemsClick = useCallback(async () => {
    await updateMemoContent(uncheckAllTasks(memo.content), "Uncheck memo task list items", "uncheck_all");
  }, [memo.content, updateMemoContent]);

  const handleDeleteMemoClick = useCallback(() => {
    setDeleteDialogOpen(true);
  }, [setDeleteDialogOpen]);

  const confirmDeleteMemo = useCallback(async () => {
    try {
      await deleteMemo(memo.name);
    } catch (error: unknown) {
      handleError(error, toast.error, { context: "Delete memo", fallbackMessage: "An error occurred" });
      return;
    }
    trackPendoEvent("memo_deleted", () => ({
      ...getMemoTrackProperties(memo),
      was_archived: memo.state === State.ARCHIVED,
      from_detail_page: isInMemoDetailPage,
      attachment_count: memo.attachments.length,
      reaction_count: memo.reactions.length,
    }));
    toast.success(t("message.deleted-successfully"));
    if (memo.parent) {
      queryClient.invalidateQueries({ queryKey: memoKeys.comments(memo.parent) });
      queryClient.invalidateQueries({ queryKey: memoKeys.detail(memo.parent) });
    }
    if (isInMemoDetailPage) {
      navigateTo(parentPage || ROUTES.HOME);
    }
    memoUpdatedCallback();
  }, [memo, t, isInMemoDetailPage, parentPage, navigateTo, memoUpdatedCallback, deleteMemo, queryClient]);

  return {
    isInMemoDetailPage,
    handleTogglePinMemoBtnClick,
    handleEditMemoClick,
    handleToggleMemoStatusClick,
    handleCopyLink,
    handleCopyContent,
    handleCheckAllTaskListItemsClick,
    handleUncheckAllTaskListItemsClick,
    handleDeleteMemoClick,
    confirmDeleteMemo,
  };
};
