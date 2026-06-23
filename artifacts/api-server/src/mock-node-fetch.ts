// Mock for node-fetch to redirect to globalThis.fetch since Node 18+ has native fetch.
const fetchMock = globalThis.fetch;
export default fetchMock;
export const Response = globalThis.Response;
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
