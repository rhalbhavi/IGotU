export async function runApi(handler, event) {
  let body;
  if (event.body) {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf8")
      : event.body;
    try {
      body = JSON.parse(raw);
    } catch {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Request body must be valid JSON." })
      };
    }
  }

  const response = {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.headers["Content-Type"] = "application/json; charset=utf-8";
      this.body = JSON.stringify(value);
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    }
  };

  const headers = Object.fromEntries(
    Object.entries(event.headers || {}).map(([name, value]) => [name.toLowerCase(), value])
  );
  await handler(
    {
      method: event.httpMethod,
      headers,
      query: event.queryStringParameters || {},
      body
    },
    response
  );

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.body
  };
}
