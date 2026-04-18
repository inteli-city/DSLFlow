// Thin wrapper around $.ajax that adds the Node-RED auth headers required by
// all httpAdmin endpoints when adminAuth is enabled.
function dsffAjax(method, url, data) {
  return $.ajax({
    method,
    url,
    data:        data ? JSON.stringify(data) : undefined,
    contentType: data ? "application/json"  : undefined,
    headers:     { "Node-RED-API-Version": "v2" },
    xhrFields:   { withCredentials: true },
  });
}
