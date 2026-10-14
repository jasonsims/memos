import { ConnectError } from "@connectrpc/connect";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { getErrorTrackProperties } from "@/lib/error";
import { getTranscriptionTrackProperties, type PendoTrackProperties, trackPendoEvent } from "@/lib/pendo";
import type { Attachment } from "@/types/proto/api/attachment_service_pb";
import type { InstanceSetting_AISetting } from "@/types/proto/api/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import { transcriptionService } from "../services";

/**
 * Transcribes an existing attachment into the draft without changing the original audio.
 * `aiSetting` only describes the transcription provider in track events.
 */
export const useAttachmentTranscription = (onText: (text: string) => void, aiSetting?: InstanceSetting_AISetting) => {
  const t = useTranslate();
  const [transcribingAttachment, setTranscribingAttachment] = useState<string>();
  const request = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => request.current?.abort(), []);

  const transcribeAttachment = useCallback(
    async (attachment: Attachment) => {
      if (request.current) return;
      const controller = new AbortController();
      request.current = controller;
      setTranscribingAttachment(attachment.name);
      // Never the transcript itself.
      const trackTranscription = (outcome: "success" | "empty" | "error", details?: PendoTrackProperties) =>
        trackPendoEvent("audio_transcription_completed", () => ({
          source: "attachment",
          outcome,
          audio_size_bytes: Number(attachment.size),
          content_type: attachment.type,
          ...getTranscriptionTrackProperties(aiSetting),
          ...details,
        }));
      try {
        const text = (await transcriptionService.transcribeAttachment(attachment, controller.signal)).trim();
        if (controller.signal.aborted) return;
        if (!text) {
          trackTranscription("empty");
          toast.error(t("editor.audio-recorder.transcribe-empty"));
          return;
        }
        onText(text);
        trackTranscription("success", { transcript_length: text.length });
        toast.success(t("editor.audio-recorder.transcribe-success"));
      } catch (error) {
        if (!controller.signal.aborted) {
          trackTranscription("error", { error_message: getErrorTrackProperties(error).error_message });
          // Server errors explain themselves; download and network failures get the translated fallback.
          toast.error((error instanceof ConnectError && error.rawMessage) || t("editor.audio-recorder.transcribe-error"));
        }
      } finally {
        request.current = undefined;
        if (!controller.signal.aborted) setTranscribingAttachment(undefined);
      }
    },
    [aiSetting, onText, t],
  );

  return { transcribeAttachment, transcribingAttachment };
};
