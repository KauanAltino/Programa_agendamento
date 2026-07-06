export type BookingPdfRow = {
  event_date: string;
  slot_time: string;
  person1: string;
  person2: string;
  phone1: string;
  class_name?: string | null;
};

type DownloadBookingsPdfOptions = {
  title: string;
  filenamePrefix: string;
  includeCategory?: boolean;
};

export const formatDateToBrShort = (yyyyMmDd: string) => {
  const [year, month, day] = yyyyMmDd.split("-");
  return `${day}/${month}/${year.slice(2)}`;
};

export const formatPhoneToBr = (phone: string) => {
  const ddd = phone.slice(0, 2);
  const number = phone.slice(2);

  if (number.length === 9) {
    return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
  }

  return `(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
};

export const downloadBookingsPdf = async (
  rows: BookingPdfRow[],
  options: DownloadBookingsPdfOptions
) => {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 40;
  const marginTop = 48;
  const marginBottom = 40;
  const lineHeight = 18;
  let y = marginTop;

  doc.setFontSize(16);
  doc.text(options.title, marginX, y);
  y += 22;

  doc.setFontSize(11);
  doc.text(
    `Gerado em: ${new Date().toLocaleString("pt-BR")} | Total de reservas ativas: ${rows.length}`,
    marginX,
    y
  );
  y += 24;

  const header = options.includeCategory
    ? "Data/Hora       |      Casal      |      Categoria    |      Telefone"
    : "Data/Hora       |      Casal      |      Telefone";

  doc.setFontSize(12);
  doc.text(header, marginX, y);
  y += 12;
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 14;

  for (const row of rows) {
    const line = options.includeCategory
      ? `${formatDateToBrShort(row.event_date)} ${row.slot_time.slice(0, 5)} | ${row.person1} e ${row.person2} | ${row.class_name || "-"} | ${formatPhoneToBr(row.phone1)}`
      : `${formatDateToBrShort(row.event_date)} ${row.slot_time.slice(0, 5)} | ${row.person1} e ${row.person2} | ${formatPhoneToBr(row.phone1)}`;

    if (y > pageHeight - marginBottom) {
      doc.addPage();
      y = marginTop;
      doc.setFontSize(12);
      doc.text(header, marginX, y);
      y += 12;
      doc.line(marginX, y, pageWidth - marginX, y);
      y += 14;
    }

    const wrapped = doc.splitTextToSize(line, pageWidth - marginX * 2);
    doc.setFontSize(11);
    doc.text(wrapped, marginX, y);
    y += wrapped.length * lineHeight;
  }

  const fileDate = new Date().toISOString().slice(0, 10);
  doc.save(`${options.filenamePrefix}-${fileDate}.pdf`);
};