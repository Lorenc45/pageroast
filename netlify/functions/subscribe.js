exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { email, url } = body;

  if (!email || !email.includes('@')) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Valid email required' }) };
  }

  try {
    const resp = await fetch('https://api.airtable.com/v0/appY9AvBPJB9VlPQO/Waitlist', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          'Email': email,
          'URL': url || '',
          'Date': new Date().toISOString().split('T')[0]
        }
      })
    });

    const responseText = await resp.text();
    console.log('Airtable status:', resp.status);
    console.log('Airtable response:', responseText);

    if (!resp.ok) {
      throw new Error(`Airtable returned ${resp.status}: ${responseText}`);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true })
    };
  } catch (e) {
    console.log('Error:', e.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message })
    };
  }
};
