'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, ArrowDownLeft, ExternalLink, Loader2, Clock, Download, FileText, FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
import { formatAddress } from '@/lib/utils';
import { downloadCSV, downloadPDF, downloadJSON } from '@/lib/export';
import { toast } from 'sonner';
import AssetLogo from './AssetLogo';

export interface Transaction {
  id: string;
  hash: string;
  type: 'sent' | 'received';
  from: string;
  to: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  memo?: string;
  createdAt: string;
  ledger: number;
}

interface TransactionHistoryProps {
  publicKey: string;
  limit?: number;
}

export default function TransactionHistory({ publicKey, limit = 20 }: TransactionHistoryProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'sent' | 'received'>('all');
  const [showExportMenu, setShowExportMenu] = useState(false);

  useEffect(() => {
    if (publicKey) {
      loadTransactions();
    }
  }, [publicKey]);

  // Close export menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showExportMenu) {
        setShowExportMenu(false);
      }
    };

    if (showExportMenu) {
      document.addEventListener('click', handleClickOutside);
    }

    return () => {
      document.removeEventListener('click', handleClickOutside);
    };
  }, [showExportMenu]);

  const loadTransactions = async () => {
    setLoading(true);
    try {
      // Import dynamically to avoid SSR issues
      const { server } = await import('@/lib/stellar');
      
      const payments = await server
        .payments()
        .forAccount(publicKey)
        .order('desc')
        .limit(limit)
        .call();

      const txs: Transaction[] = [];

      for (const payment of payments.records) {
        if (payment.type === 'payment' || payment.type === 'create_account') {
          // Get transaction to fetch memo
          const transaction = await server
            .transactions()
            .transaction(payment.transaction_hash)
            .call();

          const tx: Transaction = {
            id: payment.id,
            hash: payment.transaction_hash,
            type: payment.to === publicKey ? 'received' : 'sent',
            from: payment.from || payment.funder || '',
            to: payment.to || payment.account || '',
            amount: payment.amount || payment.starting_balance || '0',
            assetCode: payment.asset_type === 'native' ? 'XLM' : payment.asset_code || 'XLM',
            assetIssuer: payment.asset_issuer,
            memo: transaction.memo || undefined,
            createdAt: payment.created_at,
            ledger: payment.ledger_attr || 0,
          };

          txs.push(tx);
        }
      }

      setTransactions(txs);
    } catch (error) {
      console.error('Error loading transactions:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredTransactions = transactions.filter((tx) => {
    if (filter === 'all') return true;
    return tx.type === filter;
  });

  const openExplorer = (hash: string) => {
    const network = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'TESTNET' ? 'testnet' : 'public';
    window.open(`https://stellar.expert/explorer/${network}/tx/${hash}`, '_blank');
  };

  const handleExportCSV = () => {
    try {
      downloadCSV(filteredTransactions);
      toast.success('CSV file downloaded!');
      setShowExportMenu(false);
    } catch (error) {
      toast.error('Failed to export CSV');
    }
  };

  const handleExportPDF = () => {
    try {
      downloadPDF(filteredTransactions, publicKey);
      setShowExportMenu(false);
    } catch (error) {
      toast.error('Failed to download PDF');
    }
  };

  const handleExportJSON = () => {
    try {
      downloadJSON(filteredTransactions);
      toast.success('JSON file downloaded!');
      setShowExportMenu(false);
    } catch (error) {
      toast.error('Failed to export JSON');
    }
  };

  if (loading) {
    return (
      <div className="card">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-stellar-600" />
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Transaction History</h2>
        <div className="flex gap-2">
          {/* Filter buttons */}
          <div className="flex gap-2">
            {(['all', 'sent', 'received'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                  filter === f
                    ? 'bg-stellar-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>

          {/* Export button */}
          {filteredTransactions.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="px-3 py-1 text-sm rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium flex items-center gap-2 transition-colors"
              >
                <Download className="w-4 h-4" />
                Export
              </button>

              {/* Export dropdown menu */}
              {showExportMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 z-10">
                  <div className="py-1">
                    <button
                      onClick={handleExportCSV}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-3"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-green-600" />
                      <span>Export as CSV</span>
                    </button>
                    <button
                      onClick={handleExportPDF}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-3"
                    >
                      <FileText className="w-4 h-4 text-red-600" />
                      <span>Export as PDF</span>
                    </button>
                    <button
                      onClick={handleExportJSON}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100 flex items-center gap-3"
                    >
                      <FileText className="w-4 h-4 text-blue-600" />
                      <span>Export as JSON</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {filteredTransactions.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p>No {filter !== 'all' ? filter : ''} transactions yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTransactions.map((tx) => (
            <div
              key={tx.id}
              className="flex items-center justify-between p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
            >
              {/* Left side - Icon and details */}
              <div className="flex items-center gap-4 flex-1">
                {/* Direction icon */}
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center ${
                    tx.type === 'received'
                      ? 'bg-green-100 text-green-600'
                      : 'bg-blue-100 text-blue-600'
                  }`}
                >
                  {tx.type === 'received' ? (
                    <ArrowDownLeft className="w-5 h-5" />
                  ) : (
                    <ArrowUpRight className="w-5 h-5" />
                  )}
                </div>

                {/* Transaction details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-900">
                      {tx.type === 'received' ? 'Received from' : 'Sent to'}
                    </span>
                    <span className="text-sm text-gray-600 font-mono">
                      {formatAddress(tx.type === 'received' ? tx.from : tx.to, 6)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-gray-500">
                    <span>{format(new Date(tx.createdAt), 'MMM dd, yyyy HH:mm')}</span>
                    {tx.memo && (
                      <>
                        <span>•</span>
                        <span className="font-mono text-xs">{tx.memo}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Right side - Amount and asset */}
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-lg font-bold ${
                        tx.type === 'received' ? 'text-green-600' : 'text-gray-900'
                      }`}
                    >
                      {tx.type === 'received' ? '+' : '-'}
                      {parseFloat(tx.amount).toFixed(2)}
                    </span>
                    <AssetLogo assetCode={tx.assetCode} className="w-5 h-5" />
                  </div>
                  <span className="text-xs text-gray-500">{tx.assetCode}</span>
                </div>

                {/* Explorer link */}
                <button
                  onClick={() => openExplorer(tx.hash)}
                  className="p-2 text-gray-400 hover:text-stellar-600 hover:bg-white rounded-lg transition-colors"
                  title="View on Explorer"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {filteredTransactions.length > 0 && (
        <div className="mt-4 text-center">
          <button
            onClick={loadTransactions}
            className="text-sm text-stellar-600 hover:text-stellar-700 font-medium"
          >
            Refresh Transactions
          </button>
        </div>
      )}
    </div>
  );
}

