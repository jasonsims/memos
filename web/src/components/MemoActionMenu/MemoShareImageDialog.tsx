import { DownloadIcon, ImageIcon, Loader2Icon, Share2Icon } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trackPendoEvent } from "@/lib/pendo";
import type { Memo } from "@/types/proto/api/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { useMemoViewContext } from "../MemoView/MemoViewContext";
import MemoShareImagePreview from "./MemoShareImagePreview";
import {
  buildMemoShareImageFileName,
  createMemoShareImageBlob,
  getMemoShareDialogWidth,
  getMemoSharePreviewWidth,
  getMemoShareRenderWidth,
} from "./memoShareImage";

interface MemoShareImageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const trackImageExport = (
  memo: Memo,
  renderWidth: number,
  exportMethod: "download" | "native_share",
  outcome: "success" | "failed" | "cancelled" | "unsupported",
) =>
  trackPendoEvent("memo_image_exported", () => ({
    export_method: exportMethod,
    outcome,
    render_width: renderWidth,
    memo_name: memo.name,
    has_attachments: memo.attachments.length > 0,
    content_length: memo.content.length,
  }));

const MemoShareImageDialog = ({ open, onOpenChange }: MemoShareImageDialogProps) => {
  const t = useTranslate();
  const { memo, cardWidth } = useMemoViewContext();
  const previewRef = useRef<HTMLDivElement>(null);
  const [isRendering, setIsRendering] = useState(false);

  const previewWidth = useMemo(() => getMemoSharePreviewWidth(cardWidth), [cardWidth]);
  const dialogWidth = useMemo(() => getMemoShareDialogWidth(previewWidth), [previewWidth]);
  const previewRenderWidth = useMemo(() => getMemoShareRenderWidth(previewWidth, dialogWidth), [dialogWidth, previewWidth]);

  const createShareBlob = useCallback(async () => {
    const preview = previewRef.current;
    if (!preview) {
      throw new Error("Preview is not ready");
    }

    return createMemoShareImageBlob(preview);
  }, []);

  const handleDownload = useCallback(async () => {
    setIsRendering(true);
    try {
      const blob = await createShareBlob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = buildMemoShareImageFileName(memo.name);
      anchor.click();
      URL.revokeObjectURL(url);
      trackImageExport(memo, previewRenderWidth, "download", "success");
      toast.success(t("memo.share.image-downloaded"));
    } catch {
      trackImageExport(memo, previewRenderWidth, "download", "failed");
      toast.error(t("memo.share.image-download-failed"));
    } finally {
      setIsRendering(false);
    }
  }, [createShareBlob, memo, previewRenderWidth, t]);

  const handleNativeShare = useCallback(async () => {
    if (typeof navigator.share !== "function") {
      return;
    }

    setIsRendering(true);
    try {
      const blob = await createShareBlob();
      const file = new File([blob], buildMemoShareImageFileName(memo.name), { type: "image/png" });
      if (typeof navigator.canShare === "function" && !navigator.canShare({ files: [file] })) {
        trackImageExport(memo, previewRenderWidth, "native_share", "unsupported");
        toast.error(t("memo.share.image-share-failed"));
        return;
      }

      await navigator.share({
        files: [file],
        title: memo.content.slice(0, 60),
      });
      trackImageExport(memo, previewRenderWidth, "native_share", "success");
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      trackImageExport(memo, previewRenderWidth, "native_share", cancelled ? "cancelled" : "failed");
      if (!cancelled) {
        toast.error(t("memo.share.image-share-failed"));
      }
    } finally {
      setIsRendering(false);
    }
  }, [createShareBlob, memo, previewRenderWidth, t]);

  const supportsNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof navigator.canShare === "function";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="full"
        className="min-h-0 overflow-hidden !gap-0 !p-0 md:w-auto md:max-w-none"
        style={{ width: `${dialogWidth}px` }}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <DialogHeader className="shrink-0 border-b border-border/60 px-4 py-3 sm:px-5">
            <DialogTitle className="flex items-center gap-2 text-base font-medium">
              <ImageIcon className="h-4 w-4 text-muted-foreground" />
              {t("memo.share.image-title")}
            </DialogTitle>
            <DialogDescription className="text-xs">{t("memo.share.image-description", { width: previewRenderWidth })}</DialogDescription>
          </DialogHeader>

          <div className="relative flex min-h-0 flex-1 items-start justify-center overflow-auto bg-muted/20 px-4 py-3 sm:px-5 sm:py-4">
            <MemoShareImagePreview ref={previewRef} width={previewRenderWidth} />
          </div>

          <DialogFooter className="shrink-0 border-t border-border/60 px-4 py-3 sm:px-5">
            {supportsNativeShare && (
              <Button variant="quiet" onClick={handleNativeShare} disabled={isRendering}>
                {isRendering ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : <Share2Icon className="mr-2 h-4 w-4" />}
                {t("memo.share.image-share")}
              </Button>
            )}
            <Button variant="outline" onClick={handleDownload} disabled={isRendering}>
              {isRendering ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : <DownloadIcon className="mr-2 h-4 w-4" />}
              {t("memo.share.image-download")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MemoShareImageDialog;
