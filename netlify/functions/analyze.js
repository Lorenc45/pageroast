const rateLimit = {};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Rate limiting — 3 requests per IP per hour
  const ip = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 60 * 1000;

  if (!rateLimit[ip]) rateLimit[ip] = [];
  rateLimit[ip] = rateLimit[ip].filter(t => now - t < windowMs);

  if (rateLimit[ip].length >= 3) {
    return {
      statusCode: 429,
      body: JSON.stringify({ error: 'Rate limit reached. You can run 3 analyses per hour. Come back later!' })
    };
  }

  rateLimit[ip].push(now);

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { url, pageContent: manualContent } = body;

  if (!url) {
    return { statusCode: 400, body: JSON.stringify({ error: 'URL is required' }) };
  }

  // Use manual content if provided, otherwise scrape with ScrapingBee
  let pageContent = (manualContent || '').trim();

  if (!pageContent) {
    try {
      // render_js=false for speed, timeout controller to stay within Netlify's 10s limit
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 7000);
      const scrapeUrl = `https://app.scrapingbee.com/api/v1/?api_key=${process.env.SCRAPINGBEE_API_KEY}&url=${encodeURIComponent(url)}&render_js=false&extract_rules={"text":{"selector":"body","type":"text"}}`;
      const scrapeResp = await fetch(scrapeUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (scrapeResp.ok) {
        const scrapeData = await scrapeResp.json();
        pageContent = (scrapeData.text || '').replace(/\s+/g, ' ').slice(0, 8000).trim();
      }
    } catch (e) {
      pageContent = '';
    }
  }

  const prompt = `You are an expert conversion copywriter and landing page strategist who has reviewed hundreds of SaaS and indie product landing pages.

You will be given the text content of a landing page. Your job is to evaluate it using a structured rubric and return a JSON object ONLY — no explanation, no markdown, no code fences, just raw JSON.

Score each dimension from 0-100. Be honest and specific. Vague feedback is useless. Cite actual copy when identifying issues. Always provide concrete rewrites or fixes.

Evaluate these 6 dimensions:
1. Clarity - Does a stranger know exactly what this product does within 5 seconds?
2. ICP Fit - Is it obvious who this is for? Does the language speak directly to that person?
3. Pain/Outcome Framing - Does the page lead with the customer's problem and desired outcome, or with features?
4. CTA Strength - Is the call to action clear, specific, low-friction, and repeated at the right moments?
5. Social Proof - Is there credible, specific proof (numbers, names, logos, quotes)? Or is it vague/missing?
6. Objection Handling - Does the page preempt the top reasons a visitor wouldn't convert?

Return this exact JSON:
{
  "overall_score": <0-100>,
  "summary": "<2-3 sentence honest overall assessment>",
  "dimensions": [
    {
      "name": "<dimension name>",
      "score": <0-100>,
      "verdict": "<one sentence - what's working or not>",
      "issue": "<specific problem, quoting actual copy if possible>",
      "fix": "<concrete rewrite or actionable fix>"
    }
  ],
  "quick_wins": ["<fix 1>", "<fix 2>", "<fix 3>"],
  "biggest_risk": "<the single most important thing killing conversions>"
}

Page URL: ${url}
Page content:
${pageContent || 'Could not retrieve page content. Analyze based on the URL alone and clearly note this limitation in your summary.'}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Claude API error');
    }

    const data = await response.json();
    let text = data.content[0].text.trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

    JSON.parse(text);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: text
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
