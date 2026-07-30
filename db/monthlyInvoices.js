function pad2(value) { return String(value).padStart(2, '0'); }
function normalizeBillMonth(value) {
  if (!value) { const now = new Date(); return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`; }
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}`;
  return normalizeBillMonth();
}
function getCurrentBillMonth() { return normalizeBillMonth(); }
function formatBillMonthLabel(billMonth) { const [y,m]=normalizeBillMonth(billMonth).split('-').map(Number); return new Date(y,(m||1)-1,1).toLocaleString('en-US',{month:'short',year:'numeric'}); }
function sanitizeInvoices(invoices) { if (!Array.isArray(invoices)) return []; return invoices.map((inv)=>({ billMonth: normalizeBillMonth(inv.billMonth), billMonthLabel: formatBillMonthLabel(inv.billMonth), invoiceNumber: inv.invoiceNumber ? String(inv.invoiceNumber).trim() : '', currentCharges: Number(inv.currentCharges||0), perMonthDiscount: Number(inv.perMonthDiscount||0), chargesAfterDiscount: Number(inv.chargesAfterDiscount||0), status: String(inv.status||'').trim().toLowerCase()==='paid'?'paid':'unpaid', generatedAt: inv.generatedAt||null, generatedBy: inv.generatedBy?String(inv.generatedBy).trim():'', notes: inv.notes?String(inv.notes).trim():'' })).sort((a,b)=>b.billMonth.localeCompare(a.billMonth)); }
function buildInvoiceNumber(plotNo,billMonth){ const plot=String(plotNo||'').trim().toUpperCase().replace(/[^A-Z0-9]+/g,'-'); return `INV-${plot}-${normalizeBillMonth(billMonth).replace('-','')}`; }
function buildMonthlyInvoice(row,input={}){ const billMonth=normalizeBillMonth(input.billMonth); return { billMonth, billMonthLabel: formatBillMonthLabel(billMonth), invoiceNumber: input.invoiceNumber||buildInvoiceNumber(row.plotNo,billMonth), currentCharges: Number(input.currentCharges??row.monthlyCurrentCharges??0), perMonthDiscount: Number(input.perMonthDiscount??row.perMonthDiscount??0), chargesAfterDiscount: Number(input.chargesAfterDiscount??row.monthlyChargesAfterDiscount??0), status:'paid', generatedAt:new Date().toISOString(), generatedBy: input.generatedBy?String(input.generatedBy).trim():'', notes: input.notes?String(input.notes).trim():'' }; }
function mergeInvoiceIntoRow(row, invoice){ const next=sanitizeInvoices(row.invoices||[]).filter((i)=>i.billMonth!==invoice.billMonth); next.unshift(invoice); return sanitizeInvoices(next); }
function getInvoiceForMonth(row,billMonth){ const normalized=normalizeBillMonth(billMonth); return sanitizeInvoices(row.invoices||[]).find((i)=>i.billMonth===normalized)||null; }
function enrichMonthlyStatus(row={}){ const invoices=sanitizeInvoices(row.invoices||[]); const currentBillMonth=getCurrentBillMonth(); const currentMonthInvoice=invoices.find((i)=>i.billMonth===currentBillMonth)||null; return { ...row, invoices, currentBillMonth, currentBillMonthLabel: formatBillMonthLabel(currentBillMonth), currentMonthStatus: currentMonthInvoice?.status||'unpaid', currentMonthInvoice, invoicesCount: invoices.length, lastGeneratedInvoice: invoices[0]||null }; }
module.exports={ normalizeBillMonth,getCurrentBillMonth,formatBillMonthLabel,sanitizeInvoices,buildInvoiceNumber,buildMonthlyInvoice,mergeInvoiceIntoRow,getInvoiceForMonth,enrichMonthlyStatus };
