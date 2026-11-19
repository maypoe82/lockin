// Extract plain text from an uploaded PDF buffer (pdf-parse v2, built on Mozilla pdf.js).
const { PDFParse } = require('pdf-parse');

async function pdfToText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text.replace(/\u0000/g, '').trim();
  } finally {
    await parser.destroy();
  }
}

module.exports = { pdfToText };
