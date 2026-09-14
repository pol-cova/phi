import { load } from 'cheerio';

function readable($, root) {
  root.find('script[type="math/tex"]').each((_, element) => $(element).replaceWith($(element).text()));
  root.find('script,style,button,.input-output-copier,.MathJax,.MathJax_Preview').remove();
  root.find('br').replaceWith('\n');
  root.find('div.test-example-line').each((_, element) => $(element).append('\n'));
  root.find('p,pre,div,li,h1,h2,h3').each((_, element) => $(element).append('\n'));
  return root.text().replace(/\u00a0/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function sampleText($, element) {
  const root = element.clone();
  root.find('br').replaceWith('\n');
  root.find('.test-example-line').each((_, line) => $(line).append('\n'));
  const value = root.text().replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
  return value.endsWith('\n') ? value : value + '\n';
}

export function parseStatement(html, platform) {
  const $ = load(html);
  const tests = [];
  if (platform === 'codeforces') {
    const inputs = $('.sample-test .input pre');
    const outputs = $('.sample-test .output pre');
    if (inputs.length !== outputs.length) throw new Error('The sample inputs and outputs do not match.');
    inputs.each((i, element) => {
      tests.push({ input: sampleText($, $(element)), output: sampleText($, outputs.eq(i)) });
    });
  } else {
    $('pre').each((_, element) => {
      const text = $(element).text();
      const match = text.match(/Input\s*:\s*([\s\S]*?)\s*Output\s*:\s*([\s\S]*?)(?:\s*Explanation\s*:|$)/i);
      if (match) tests.push({ input: match[1].trim(), output: match[2].trim() });
    });
  }
  return { statement: readable($, $.root()), tests };
}

export function normalizeOutput(value, comparison = 'tokens') {
  if (comparison === 'exact') return value.replace(/\r\n/g, '\n').replace(/\n$/, '');
  if (comparison !== 'tokens') throw new Error('Comparison must be tokens or exact.');
  return value.trim().split(/\s+/).join(' ');
}

export function parseVerdict(text) {
  for (const line of text.split('\n').map(line => line.trim())) {
    const match = line.match(/^(Accepted|Wrong Answer|Runtime Error|Compile Error|Compilation Error|Time Limit Exceeded|Memory Limit Exceeded|Output Limit Exceeded|Internal Error|Judgement Failed|Failed|Success)(?:\s*[:!]|$)/i);
    if (match) return { verdict: match[1], accepted: /^(Accepted|Success)$/i.test(match[1]), details: text.trim() };
  }
  return null;
}
