"use client";

import { useState, type RefObject } from "react";

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
      const imgData = canvas.toDataURL("image/png");

      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      // Slice the tall rasterized image across as many A4 pages as needed,
      // shifting the image up by one page height each time.
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

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
