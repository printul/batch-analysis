// server/openai.ts

import fs from 'fs/promises';
import pdfjsLib from 'pdfjs-dist';
import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type DocInput = { id: number; filename: string; filePath: string };

enum ChunkSize {
  MAX = 30000,
}

// Extract text from a file (PDF or text)
async function extractTextFromFile(path: string): Promise<string> {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') {
    const data = new Uint8Array(await fs.readFile(path));
    const loadingTask = pdfjsLib.getDocument({ data });
    const pdf = await loadingTask.promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const strings = content.items.map((item: any) => item.str);
      text += strings.join(' ') + '\n';
    }
    return text;
  } else {
    return await fs.readFile(path, 'utf8');
  }
}

// Split into chunks under API token limits
function chunkText(text: string, maxLen: number = ChunkSize.MAX): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + maxLen));
    start += maxLen;
  }
  return chunks;
}

// Analyze an array of documents, returning per-document analysis and an optional batch comparison
export async function analyzeDocuments(
  docs: DocInput[]
): Promise<any[]> {
  const results: any[] = [];

  // Per-document analysis
  for (const doc of docs) {
    const rawText = await extractTextFromFile(doc.filePath);
    const chunks = chunkText(rawText);
    let combinedSummary = '';

    for (const chunk of chunks) {
      const resp = await openai.chat.completions.create({
        model: 'gpt-4o-high',
        messages: [
          { role: 'system', content: 'You are a document analysis assistant.' },
          { role: 'user', content: `Analyze the following text and return a JSON object with keys: summary, themes, sentimentScore, recommendations. Text: ${chunk}` }
        ],
      });
      combinedSummary += resp.choices[0].message.content;
    }

    // Parse JSON (assuming assistant returns valid JSON)
    let analysis;
    try {
      analysis = JSON.parse(combinedSummary);
    } catch {
      analysis = { error: 'Failed to parse analysis JSON', raw: combinedSummary };
    }

    results.push({ id: doc.id, filename: doc.filename, ...analysis });
  }

  // If multiple docs, add a comparative analysis
  if (docs.length > 1) {
    const comparePrompt = docs.map(d => `Doc ${d.id}: ${d.filename}`).join('\n');
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-high',
      messages: [
        { role: 'system', content: 'You compare documents analysis.' },
        { role: 'user', content: `Compare the analyses of the following documents:
${comparePrompt}
Provide JSON with keys: commonPoints, differences.` }
      ],
    });

    let compare;
    try {
      compare = JSON.parse(resp.choices[0].message.content);
    } catch {
      compare = { error: 'Failed to parse comparison JSON', raw: resp.choices[0].message.content };
    }

    results.push({ comparison: compare });
  }

  return results;
}
