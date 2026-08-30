function invoiceSharePath(id) {
  return `/pay/${encodeURIComponent(id)}`;
}

module.exports = { invoiceSharePath };
