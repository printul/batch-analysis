import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';

/**
 * Debug utility for PDF extraction using pdf-parse
 * Run this directly with: tsx server/pdf-debug.ts
 */

async function extractPdfText() {
  // Target the PDF file
  const pdfPath = path.join('uploads', 'documents', '1745679314592-281134039.pdf');
  
  // Read the file
  console.log(`Reading PDF file from: ${pdfPath}`);
  const dataBuffer = fs.readFileSync(pdfPath);
  console.log(`File size: ${dataBuffer.length} bytes`);
  
  try {
    console.log('Using pdf-parse for extraction...');
    const data = await pdfParse(dataBuffer);
    
    // Log basic info
    console.log(`\nPDF Info:`);
    console.log(`Number of pages: ${data.numpages}`);
    console.log(`PDF Version: ${data.info.PDFFormatVersion}`);
    console.log(`Extracted text length: ${data.text.length} characters`);
    
    // Let's look for key markers that should be in a financial report
    const searchTerms = ['S&P', 'bull', 'bear', 'market', 'fund', 'gold', 'stock', 'BofA', 'Hartnett', 'bond', 'flow', 'sell', 'rips', 'stay'];
    console.log('\n=== SEARCH FOR KEY TERMS ===\n');
    
    searchTerms.forEach(term => {
      const regex = new RegExp(term, 'gi');
      const matches = data.text.match(regex);
      console.log(`"${term}": ${matches ? matches.length : 0} matches`);
    });
    
    // Write the extracted text to a file
    const debugFilePath = path.join('uploads', 'pdf-debug-output.txt');
    fs.writeFileSync(debugFilePath, data.text);
    console.log(`\nFull text written to ${debugFilePath}`);
    
    // Preview
    console.log('\n=== TEXT PREVIEW (first 1000 chars) ===\n');
    console.log(data.text.substring(0, 1000));
    
  } catch (error) {
    console.error('Error parsing PDF:', error);
  }
}

// Run the extraction
extractPdfText().catch(console.error);