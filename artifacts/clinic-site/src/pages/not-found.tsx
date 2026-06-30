import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "hsl(var(--cd-scan-white))", padding: "1.5rem" }}>
      <div className="cd-card" style={{ maxWidth: 420, padding: "2.5rem", textAlign: "center" }}>
        <span className="cd-appt-status-icon cd-appt-status-fail" style={{ marginBottom: "1rem" }} aria-hidden="true">
          <AlertCircle size={28} />
        </span>
        <h1 className="cd-display" style={{ fontSize: "1.5rem", fontWeight: 600, color: "hsl(var(--cd-slate))" }}>Page not found</h1>
        <p className="cd-section-sub" style={{ fontSize: ".9375rem", margin: ".5rem 0 0" }}>
          The page you're looking for doesn't exist or may have moved.
        </p>
        <a href="/" className="cd-btn-primary" style={{ marginTop: "1.5rem", justifyContent: "center" }}>
          Back to Home
        </a>
      </div>
    </div>
  );
}
