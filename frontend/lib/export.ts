import { format } from 'date-fns';
import {
  assertPaymentProofAvailable,
  canExportPaymentProof,
} from './payment-proof-policy.js';

export { assertPaymentProofAvailable, canExportPaymentProof };

const HTML_ESCAPE_CHARACTERS: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#039;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPE_CHARACTERS[character]);
}

interface Invoice {
  id: string;
  amount: number;
  assetCode: string;
  assetIssuer?: string;
  description?: string;
  customerName?: string;
  customerEmail?: string;
  sellerName?: string;
  sellerEmail?: string;
  payerName?: string;
  payerEmail?: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  paidAt?: string;
  memo: string;
  sellerPublicKey: string;
  payerPublicKey?: string;
  paymentTxHash?: string;
}

export function generateInvoiceCSV(invoices: Invoice[]): string {
  const headers = [
    'Invoice ID',
    'Date',
    'Seller Name',
    'Seller Email',
    'Customer Name',
    'Customer Email',
    'Description',
    'Amount',
    'Asset',
    'Status',
    'Payment Date',
    'Payer Name',
    'Payer Email',
    'Expires At',
    'Memo',
    'Transaction Hash',
  ];

  const rows = invoices.map((inv) => [
    inv.id,
    format(new Date(inv.createdAt), 'yyyy-MM-dd HH:mm:ss'),
    inv.sellerName || '',
    inv.sellerEmail || '',
    inv.customerName || '',
    inv.customerEmail || '',
    inv.description || '',
    inv.amount,
    inv.assetCode,
    inv.status,
    inv.paidAt ? format(new Date(inv.paidAt), 'yyyy-MM-dd HH:mm:ss') : '',
    inv.payerName || '',
    inv.payerEmail || '',
    format(new Date(inv.expiresAt), 'yyyy-MM-dd HH:mm:ss'),
    inv.memo,
    inv.paymentTxHash || '',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
  ].join('\n');

  return csvContent;
}

export function downloadInvoiceCSV(invoices: Invoice[], filename?: string) {
  const csv = generateInvoiceCSV(invoices);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  const defaultFilename = `invoices-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.csv`;
  link.setAttribute('href', url);
  link.setAttribute('download', filename || defaultFilename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function generateInvoicePDF(invoice: Invoice): string {
  assertPaymentProofAvailable(invoice);
  const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'TESTNET' ? 'Testnet' : 'Mainnet';
  const isPaid = invoice.status === 'PAID';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Invoice ${escapeHtml(invoice.id)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: Arial, sans-serif; 
      padding: 20px; 
      color: #333; 
      background: white; 
      font-size: 14px;
      line-height: 1.4;
    }
    .header { 
      display: flex; 
      justify-content: space-between; 
      margin-bottom: 30px; 
      padding-bottom: 15px; 
      border-bottom: 2px solid #06b6d4; 
    }
    .logo { 
      font-size: 24px; 
      font-weight: bold; 
      color: #06b6d4; 
    }
    .invoice-title { 
      text-align: right; 
    }
    .invoice-title h1 { 
      font-size: 28px; 
      color: #333; 
      margin-bottom: 5px; 
    }
    .invoice-number { 
      color: #666; 
      font-size: 12px; 
    }
    .status-badge { 
      display: inline-block; 
      padding: 4px 8px; 
      border-radius: 4px; 
      font-size: 10px; 
      font-weight: 600; 
      text-transform: uppercase; 
      margin-top: 8px; 
    }
    .status-paid { background: #d1fae5; color: #065f46; }
    .status-pending { background: #fef3c7; color: #92400e; }
    .status-expired { background: #fee2e2; color: #991b1b; }
    .info-grid { 
      display: flex; 
      gap: 20px; 
      margin-bottom: 30px; 
    }
    .info-section { 
      flex: 1;
      padding: 15px; 
      background: #f9fafb; 
      border-radius: 6px; 
    }
    .info-section h3 { 
      font-size: 12px; 
      color: #666; 
      text-transform: uppercase; 
      margin-bottom: 10px; 
      letter-spacing: 0.5px; 
    }
    .info-row { 
      margin-bottom: 8px; 
    }
    .info-label { 
      font-size: 10px; 
      color: #666; 
      margin-bottom: 2px; 
    }
    .info-value { 
      font-size: 12px; 
      color: #333; 
      font-weight: 500; 
    }
    .amount-section { 
      background: #06b6d4; 
      padding: 20px; 
      border-radius: 8px; 
      text-align: center; 
      margin-bottom: 20px; 
    }
    .amount-label { 
      color: white; 
      font-size: 12px; 
      margin-bottom: 8px; 
    }
    .amount-value { 
      font-size: 36px; 
      font-weight: bold; 
      color: white; 
      margin-bottom: 5px; 
    }
    .amount-asset { 
      color: white; 
      font-size: 16px; 
      font-weight: 600; 
    }
    .details-table { 
      width: 100%; 
      margin-bottom: 20px; 
    }
    .details-table tr { 
      border-bottom: 1px solid #e5e7eb; 
    }
    .details-table td { 
      padding: 8px 0; 
    }
    .details-table td:first-child { 
      color: #666; 
      font-size: 11px; 
      width: 30%; 
    }
    .details-table td:last-child { 
      color: #333; 
      font-size: 12px; 
      font-weight: 500; 
    }
    .footer { 
      margin-top: 30px; 
      padding-top: 15px; 
      border-top: 1px solid #e5e7eb; 
      text-align: center; 
      color: #666; 
      font-size: 10px; 
    }
    .blockchain-info { 
      background: #fef3c7; 
      padding: 10px; 
      border-radius: 6px; 
      margin-bottom: 15px; 
      border-left: 3px solid #f59e0b; 
    }
    .blockchain-info p { 
      font-size: 10px; 
      color: #92400e; 
      line-height: 1.4; 
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">Quittance</div>
    <div class="invoice-title">
      <h1>INVOICE</h1>
      <div class="invoice-number">#${escapeHtml(invoice.id.substring(0, 8).toUpperCase())}</div>
      <span class="status-badge status-${escapeHtml(invoice.status.toLowerCase())}">${escapeHtml(invoice.status)}</span>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-section">
      <h3>Bill To</h3>
      ${invoice.customerName ? `<div class="info-row"><div class="info-label">Customer Name</div><div class="info-value">${escapeHtml(invoice.customerName)}</div></div>` : ''}
      ${invoice.customerEmail ? `<div class="info-row"><div class="info-label">Email</div><div class="info-value">${escapeHtml(invoice.customerEmail)}</div></div>` : ''}
      ${!invoice.customerName && !invoice.customerEmail ? `<div class="info-value">N/A</div>` : ''}
    </div>

    <div class="info-section">
      <h3>Invoice Details</h3>
      <div class="info-row">
        <div class="info-label">Issue Date</div>
        <div class="info-value">${format(new Date(invoice.createdAt), 'MMM dd, yyyy')}</div>
      </div>
      <div class="info-row">
        <div class="info-label">Expires</div>
        <div class="info-value">${format(new Date(invoice.expiresAt), 'MMM dd, yyyy')}</div>
      </div>
      ${isPaid ? `<div class="info-row"><div class="info-label">Payment Date</div><div class="info-value">${format(new Date(invoice.paidAt!), 'MMM dd, yyyy HH:mm')}</div></div>` : ''}
    </div>
  </div>

  ${invoice.sellerName || invoice.sellerEmail ? `
  <div class="info-section" style="margin-bottom: 20px;">
    <h3>Seller Information</h3>
    ${invoice.sellerName ? `<div class="info-row"><div class="info-label">Name</div><div class="info-value">${escapeHtml(invoice.sellerName)}</div></div>` : ''}
    ${invoice.sellerEmail ? `<div class="info-row"><div class="info-label">Email</div><div class="info-value">${escapeHtml(invoice.sellerEmail)}</div></div>` : ''}
  </div>` : ''}

  ${isPaid && (invoice.payerName || invoice.payerEmail) ? `
  <div class="info-section" style="margin-bottom: 20px;">
    <h3>Payer Information</h3>
    ${invoice.payerName ? `<div class="info-row"><div class="info-label">Name</div><div class="info-value">${escapeHtml(invoice.payerName)}</div></div>` : ''}
    ${invoice.payerEmail ? `<div class="info-row"><div class="info-label">Email</div><div class="info-value">${escapeHtml(invoice.payerEmail)}</div></div>` : ''}
  </div>` : ''}

  <div class="amount-section">
    <div class="amount-label">Amount ${isPaid ? 'Paid' : 'Due'}</div>
    <div class="amount-value">${invoice.amount}</div>
    <div class="amount-asset">${escapeHtml(invoice.assetCode)}</div>
  </div>

  ${invoice.description ? `<div class="info-section" style="margin-bottom: 20px;"><h3>Description</h3><p style="color: #1f2937; line-height: 1.6;">${escapeHtml(invoice.description)}</p></div>` : ''}

  <table class="details-table">
    <tr><td>Invoice ID</td><td style="font-family: monospace; font-size: 12px;">${escapeHtml(invoice.id)}</td></tr>
    <tr><td>Memo</td><td style="font-family: monospace;">${escapeHtml(invoice.memo)}</td></tr>
    <tr><td>Seller Address</td><td style="font-family: monospace; font-size: 11px; word-break: break-all;">${escapeHtml(invoice.sellerPublicKey)}</td></tr>
    ${isPaid && invoice.paymentTxHash ? `
    <tr><td>Transaction Hash</td><td style="font-family: monospace; font-size: 11px; word-break: break-all;">${escapeHtml(invoice.paymentTxHash)}</td></tr>
    <tr><td>Payer Address</td><td style="font-family: monospace; font-size: 11px; word-break: break-all;">${escapeHtml(invoice.payerPublicKey || 'N/A')}</td></tr>
    ${invoice.payerName ? `<tr><td>Payer Name</td><td>${escapeHtml(invoice.payerName)}</td></tr>` : ''}
    ${invoice.payerEmail ? `<tr><td>Payer Email</td><td>${escapeHtml(invoice.payerEmail)}</td></tr>` : ''}` : ''}
    <tr><td>Network</td><td>${network}</td></tr>
  </table>

  ${isPaid ? `<div class="blockchain-info"><p><strong>Payment Verified</strong></p><p>This payment has been verified and recorded on the Stellar blockchain.</p></div>` : ''}

  <div class="footer">
    <p><strong>Quittance</strong> - Stellar Payment Platform</p>
    <p>Generated on ${format(new Date(), 'PPpp')}</p>
    <p style="margin-top: 10px;">This is an automatically generated invoice.</p>
  </div>

  <div style="position: fixed; top: 10px; right: 10px; background: #06b6d4; color: white; padding: 15px; border-radius: 8px; z-index: 1000; max-width: 300px; font-family: Arial, sans-serif;">
    <h3 style="margin: 0 0 10px 0; font-size: 14px;">PDF olarak kaydetmek için:</h3>
    <ol style="margin: 0; padding-left: 20px; font-size: 12px;">
      <li>Ctrl+P (Windows) veya Cmd+P (Mac)</li>
      <li>"Hedef" → "PDF olarak kaydet"</li>
      <li>"Yazdır" butonuna bas</li>
    </ol>
    <button onclick="window.print()" style="background: white; color: #06b6d4; border: none; padding: 8px 16px; border-radius: 4px; margin-top: 10px; cursor: pointer; font-weight: bold; font-size: 12px;">
      PDF Olarak Kaydet
    </button>
  </div>

</body>
</html>`;
}

export function openInvoicePDF(invoice: Invoice) {
  const pdfContent = generateInvoicePDF(invoice);
  
  // Open in new window for PDF printing
  const printWindow = window.open('', '_blank', 'width=800,height=600');
  if (printWindow) {
    printWindow.document.write(pdfContent);
    printWindow.document.close();
    
    // Auto-trigger print dialog after content loads
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
      }, 500);
    };
  }
}

export function shareInvoiceByEmail(invoice: Invoice) {
  assertPaymentProofAvailable(invoice);
  if (!invoice.customerEmail) {
    throw new Error('Client email is required to send this invoice');
  }

  const subject = `Invoice #${invoice.id.substring(0, 8).toUpperCase()} - ${invoice.amount} ${invoice.assetCode}`;
  const isPaid = invoice.status === 'PAID';
  
  let body = `Invoice Details:\n`;
  body += `Invoice ID: ${invoice.id}\n`;
  body += `Amount: ${invoice.amount} ${invoice.assetCode}\n`;
  body += `Status: ${invoice.status}\n`;
  
  if (invoice.customerName) body += `Client: ${invoice.customerName}\n`;
  if (invoice.description) body += `Description: ${invoice.description}\n`;
  
  if (isPaid && invoice.paymentTxHash) {
    body += `\nPayment Information:\n`;
    body += `Payment Date: ${format(new Date(invoice.paidAt!), 'PPpp')}\n`;
    body += `Transaction Hash: ${invoice.paymentTxHash}\n`;
    if (invoice.payerPublicKey) body += `Payer Address: ${invoice.payerPublicKey}\n`;
    body += `Verified on Stellar Blockchain\n`;
  } else {
    body += `\nQuittance: ${window.location.origin}/pay/${invoice.id}\n`;
  }
  
  body += `\nPowered by Quittance`;
  
  const mailtoLink = `mailto:${invoice.customerEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = mailtoLink;
}
