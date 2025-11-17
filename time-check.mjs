import fetch from "node-fetch";

console.log("=== TIME CHECK ===");

const url = process.env.SUPABASE_URL + "/rest/v1/rpc/now_fn";

try {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: "{}"
  });

  const data = await res.json();
  console.log("DB NOW =", data);
} catch (err) {
  console.error("ERROR:", err);
}
