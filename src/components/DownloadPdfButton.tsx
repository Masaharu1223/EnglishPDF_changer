"use client";

import { useState, type RefObject } from "react";
import { PDF_MARGIN_PT, computePdfLayout } from "@/lib/pdf-layout";

interface DownloadPdfButtonProps {
  targetRef: RefObject<HTMLElement>;
  fileName: string;
  label?: string;
}

// Renders the target element into a PDF client-side (html2canvas rasterizes
// the DOM, jsPDF packages the image into pages). Rasterizing avoids the
// Japanese-font-embedding problem that plain text-based PDF generation
// would hit, since translations mix English and Japanese.
export default function DownloadPdfButton({
  targetRef,
  fileName,
  label = "PDFをダウンロード",
}: DownloadPdfButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);

  const handleDownload = async () => {
    const target = targetRef.current;
    if (!target || isGenerating) return;

    setIsGenerating(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      const canvas = await html2canvas(target, {
        scale: 2,
        backgroundColor: "#ffffff",
      });
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const { contentWidthPt, slices } = computePdfLayout(
        canvas.width,
        canvas.height,
        pdf.internal.pageSize.getWidth(),
        pdf.internal.pageSize.getHeight()
      );

      // Cut the tall rasterized image into page-sized slices and place each one
      // inside the margins (see computePdfLayout for why not shift-and-repeat).
      slices.forEach((slice, index) => {
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = slice.sourceHeight;
        const ctx = pageCanvas.getContext("2d");
        if (!ctx) throw new Error("Canvas 2D context is not available");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(
          canvas,
          0, slice.sourceY, canvas.width, slice.sourceHeight,
          0, 0, canvas.width, slice.sourceHeight
        );

        if (index > 0) pdf.addPage();
        pdf.addImage(
          pageCanvas.toDataURL("image/png"),
          "PNG",
          PDF_MARGIN_PT,
          PDF_MARGIN_PT,
          contentWidthPt,
          slice.heightPt
        );
      });

      pdf.save(fileName);
    } catch (error) {
      console.error("Failed to generate PDF", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={isGenerating}
      className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isGenerating ? "生成中..." : label}
    </button>
  );
}
