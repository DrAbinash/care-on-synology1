// Mock adapter — for development and demos.
// Generates a test card image using canvas-like logic (a simple colored rectangle
// with text) encoded as base64 JPEG.
import crypto from "node:crypto";

function createTestImage() {
  // Simple 300x200 test pattern as raw RGB, then we’d need JPEG encoding.
  // For mock mode, we return a tiny 1x1 red pixel JPEG (base64).
  // This is a valid minimal JPEG.
  const tinyJpeg = Buffer.from(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8Af//Z",
    "base64"
  );
  return {
    imageBase64: tinyJpeg.toString("base64"),
    mimeType: "image/jpeg",
    width: 1,
    height: 1,
  };
}

export default {
  name: "mock",
  async status() {
    return { deviceConnected: true, deviceModel: "mock-scanner", type: "mock" };
  },
  async scan() {
    // Simulate scan taking ~800ms
    await new Promise((r) => setTimeout(r, 800));
    return createTestImage();
  },
};
