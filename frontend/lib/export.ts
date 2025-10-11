/**
 * Transaction Export Utilities
 * Export transaction history to CSV and PDF formats
 */

import { format } from 'date-fns';
import type { Transaction } from '@/components/TransactionHistory';

/**
 * Convert transactions to CSV format
 */
export function generateCSV(transactions: Transaction[]): string {
  const headers = [
    'Date',
    'Time',
    'Type',
    'Hash',
    'From',
    'To',
    'Amount',
    'Asset',
    'Memo',
    'Ledger',
  ];

  const rows = transactions.map((tx) => [
    format(new Date(tx.createdAt), 'yyyy-MM-dd'),
    format(new Date(tx.createdAt), 'HH:mm:ss'),
    tx.type.toUpperCase(),
    tx.hash,
    tx.from,
    tx.to,
    tx.amount,
    tx.assetCode,
    tx.memo || '',
    tx.ledger.toString(),
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
  ].join('\n');

  return csvContent;
}

/**
 * Download CSV file
 */
export function downloadCSV(transactions: Transaction[], filename?: string) {
  const csv = generateCSV(transactions);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  const defaultFilename = `stellink-transactions-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.csv`;
  link.setAttribute('href', url);
  link.setAttribute('download', filename || defaultFilename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generate PDF content (HTML that can be printed/saved as PDF)
 */
export function generatePDFContent(
  transactions: Transaction[],
  publicKey: string
): string {
  const totalReceived = transactions
    .filter((tx) => tx.type === 'received')
    .reduce((sum, tx) => sum + parseFloat(tx.amount), 0);

  const totalSent = transactions
    .filter((tx) => tx.type === 'sent')
    .reduce((sum, tx) => sum + parseFloat(tx.amount), 0);

  const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'TESTNET' ? 'Testnet' : 'Mainnet';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Stellink Transaction History</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Arial', sans-serif;
      padding: 40px;
      color: #1f2937;
      background: white;
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
      padding-bottom: 20px;
      border-bottom: 3px solid #4f46e5;
    }
    .logo {
      font-size: 32px;
      font-weight: bold;
      color: #4f46e5;
      margin-bottom: 10px;
    }
    .subtitle {
      color: #6b7280;
      font-size: 14px;
    }
    .info-section {
      margin-bottom: 30px;
      padding: 20px;
      background: #f9fafb;
      border-radius: 8px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .info-label {
      font-weight: 600;
      color: #6b7280;
    }
    .info-value {
      font-family: monospace;
      color: #1f2937;
    }
    .summary {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
      margin-bottom: 30px;
    }
    .summary-card {
      padding: 20px;
      background: #f3f4f6;
      border-radius: 8px;
      text-align: center;
    }
    .summary-label {
      font-size: 12px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .summary-value {
      font-size: 24px;
      font-weight: bold;
      color: #1f2937;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 30px;
    }
    th {
      background: #4f46e5;
      color: white;
      padding: 12px 8px;
      text-align: left;
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
    }
    td {
      padding: 12px 8px;
      border-bottom: 1px solid #e5e7eb;
      font-size: 12px;
    }
    tr:hover {
      background: #f9fafb;
    }
    .type-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .type-received {
      background: #d1fae5;
      color: #065f46;
    }
    .type-sent {
      background: #dbeafe;
      color: #1e40af;
    }
    .amount-received {
      color: #059669;
      font-weight: 600;
    }
    .amount-sent {
      color: #1f2937;
      font-weight: 600;
    }
    .footer {
      text-align: center;
      color: #6b7280;
      font-size: 12px;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
    }
    .address {
      font-family: monospace;
      font-size: 10px;
      word-break: break-all;
    }
    @media print {
      body {
        padding: 20px;
      }
      .no-print {
        display: none;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">💫 Stellink</div>
    <div class="subtitle">Transaction History Report</div>
  </div>

  <div class="info-section">
    <div class="info-row">
      <span class="info-label">Account Address:</span>
      <span class="info-value address">${publicKey}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Network:</span>
      <span class="info-value">${network}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Report Date:</span>
      <span class="info-value">${format(new Date(), 'PPpp')}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Total Transactions:</span>
      <span class="info-value">${transactions.length}</span>
    </div>
  </div>

  <div class="summary">
    <div class="summary-card">
      <div class="summary-label">Total Received</div>
      <div class="summary-value amount-received">+${totalReceived.toFixed(2)} XLM</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Total Sent</div>
      <div class="summary-value amount-sent">-${totalSent.toFixed(2)} XLM</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Net Balance</div>
      <div class="summary-value">${(totalReceived - totalSent).toFixed(2)} XLM</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Date & Time</th>
        <th>Type</th>
        <th>From/To</th>
        <th>Amount</th>
        <th>Asset</th>
        <th>Memo</th>
        <th>Hash</th>
      </tr>
    </thead>
    <tbody>
      ${transactions
        .map(
          (tx) => `
        <tr>
          <td>${format(new Date(tx.createdAt), 'MMM dd, yyyy HH:mm')}</td>
          <td>
            <span class="type-badge type-${tx.type}">
              ${tx.type === 'received' ? '↓ Received' : '↑ Sent'}
            </span>
          </td>
          <td class="address">
            ${tx.type === 'received' ? tx.from : tx.to}
          </td>
          <td class="amount-${tx.type}">
            ${tx.type === 'received' ? '+' : '-'}${parseFloat(tx.amount).toFixed(2)}
          </td>
          <td>${tx.assetCode}</td>
          <td>${tx.memo || '-'}</td>
          <td class="address">${tx.hash.substring(0, 16)}...</td>
        </tr>
      `
        )
        .join('')}
    </tbody>
  </table>

  <div class="footer">
    <p>Generated by Stellink - Stellar Payment Platform</p>
    <p>This is an automatically generated report. All transactions are recorded on the Stellar blockchain.</p>
  </div>

  <button class="no-print" onclick="window.print()" style="
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 24px;
    background: #4f46e5;
    color: white;
    border: none;
    border-radius: 8px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  ">
    🖨️ Print / Save as PDF
  </button>
</body>
</html>
  `;
}

/**
 * Open PDF preview in new window
 */
export function openPDFPreview(transactions: Transaction[], publicKey: string) {
  const pdfContent = generatePDFContent(transactions, publicKey);
  const printWindow = window.open('', '_blank');

  if (printWindow) {
    printWindow.document.write(pdfContent);
    printWindow.document.close();
  } else {
    alert('Please allow popups to view the PDF preview');
  }
}

/**
 * Download JSON format (for backup/data portability)
 */
export function downloadJSON(transactions: Transaction[], filename?: string) {
  const json = JSON.stringify(transactions, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  const defaultFilename = `stellink-transactions-${format(new Date(), 'yyyy-MM-dd-HHmmss')}.json`;
  link.setAttribute('href', url);
  link.setAttribute('download', filename || defaultFilename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

