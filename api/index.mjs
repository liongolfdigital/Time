import app from "../server.mjs";

export default function handler(request, response) {
  return app(request, response);
}
