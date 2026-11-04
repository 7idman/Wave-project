global.fetch = async () =>
  new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
