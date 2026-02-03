'use client';

import dynamic from 'next/dynamic';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import 'swagger-ui-react/swagger-ui.css';

// Dynamic import to avoid SSR issues
const SwaggerUI = dynamic(() => import('swagger-ui-react'), { 
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-20">
      <div className="text-gray-400">Loading API docs...</div>
    </div>
  ),
});

export default function DocsPage() {
  return (
    <main className="min-h-screen flex flex-col bg-[#1a1a2e]">
      <Header />

      <section className="py-8 px-6 flex-1">
        <div className="max-w-6xl mx-auto">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-white mb-2">API Documentation</h1>
            <p className="text-gray-400">
              Build integrations with ClawdVault. Perfect for AI agents, bots, and developers.
            </p>
          </div>

          {/* Swagger UI with dark theme overrides */}
          <div className="swagger-dark rounded-xl overflow-hidden border border-gray-800">
            <SwaggerUI 
              url="/openapi.yaml"
              docExpansion="list"
              defaultModelsExpandDepth={-1}
              displayRequestDuration={true}
            />
          </div>
        </div>
      </section>

      <Footer />

      <style jsx global>{`
        /* Dark theme overrides for Swagger UI */
        .swagger-dark .swagger-ui {
          background: #1a1a2e;
        }
        .swagger-dark .swagger-ui .topbar {
          display: none;
        }
        .swagger-dark .swagger-ui .info {
          margin: 20px 0;
        }
        .swagger-dark .swagger-ui .info .title,
        .swagger-dark .swagger-ui .info .title small {
          color: #fff !important;
        }
        .swagger-dark .swagger-ui .info .description p,
        .swagger-dark .swagger-ui .info .description {
          color: #9ca3af !important;
        }
        .swagger-dark .swagger-ui .info .description code {
          background: #374151;
          color: #f97316;
        }
        .swagger-dark .swagger-ui .scheme-container {
          background: #111827;
          box-shadow: none;
          padding: 15px;
        }
        .swagger-dark .swagger-ui .opblock-tag {
          color: #fff !important;
          border-bottom: 1px solid #374151;
        }
        .swagger-dark .swagger-ui .opblock-tag:hover {
          background: rgba(55, 65, 81, 0.5);
        }
        .swagger-dark .swagger-ui .opblock {
          background: #111827;
          border: 1px solid #374151;
          border-radius: 8px;
          margin-bottom: 10px;
        }
        .swagger-dark .swagger-ui .opblock .opblock-summary {
          border-bottom: 1px solid #374151;
        }
        .swagger-dark .swagger-ui .opblock .opblock-summary-method {
          border-radius: 4px;
          font-weight: 600;
        }
        .swagger-dark .swagger-ui .opblock .opblock-summary-path,
        .swagger-dark .swagger-ui .opblock .opblock-summary-path__deprecated {
          color: #fff !important;
        }
        .swagger-dark .swagger-ui .opblock .opblock-summary-description {
          color: #9ca3af !important;
        }
        .swagger-dark .swagger-ui .opblock.opblock-get {
          background: rgba(59, 130, 246, 0.1);
          border-color: rgba(59, 130, 246, 0.3);
        }
        .swagger-dark .swagger-ui .opblock.opblock-get .opblock-summary {
          border-color: rgba(59, 130, 246, 0.3);
        }
        .swagger-dark .swagger-ui .opblock.opblock-post {
          background: rgba(34, 197, 94, 0.1);
          border-color: rgba(34, 197, 94, 0.3);
        }
        .swagger-dark .swagger-ui .opblock.opblock-post .opblock-summary {
          border-color: rgba(34, 197, 94, 0.3);
        }
        .swagger-dark .swagger-ui .opblock.opblock-delete {
          background: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.3);
        }
        .swagger-dark .swagger-ui .opblock.opblock-delete .opblock-summary {
          border-color: rgba(239, 68, 68, 0.3);
        }
        .swagger-dark .swagger-ui .opblock-body {
          background: #0d1117;
        }
        .swagger-dark .swagger-ui .opblock-body pre {
          background: #161b22 !important;
          color: #e6edf3 !important;
        }
        .swagger-dark .swagger-ui .opblock-section-header {
          background: #1f2937;
          box-shadow: none;
        }
        .swagger-dark .swagger-ui .opblock-section-header h4 {
          color: #fff !important;
        }
        .swagger-dark .swagger-ui .opblock-description-wrapper p,
        .swagger-dark .swagger-ui .opblock-external-docs-wrapper p {
          color: #9ca3af !important;
        }
        .swagger-dark .swagger-ui table thead tr th,
        .swagger-dark .swagger-ui table thead tr td {
          color: #fff !important;
          border-bottom: 1px solid #374151;
        }
        .swagger-dark .swagger-ui table tbody tr td {
          color: #d1d5db !important;
          border-bottom: 1px solid #1f2937;
        }
        .swagger-dark .swagger-ui .parameter__name,
        .swagger-dark .swagger-ui .parameter__type {
          color: #60a5fa !important;
        }
        .swagger-dark .swagger-ui .parameter__name.required::after {
          color: #f87171 !important;
        }
        .swagger-dark .swagger-ui .model-title {
          color: #fff !important;
        }
        .swagger-dark .swagger-ui .model {
          color: #d1d5db !important;
        }
        .swagger-dark .swagger-ui .prop-type {
          color: #34d399 !important;
        }
        .swagger-dark .swagger-ui .prop-format {
          color: #9ca3af !important;
        }
        .swagger-dark .swagger-ui select {
          background: #1f2937;
          color: #fff;
          border: 1px solid #374151;
        }
        .swagger-dark .swagger-ui input[type=text],
        .swagger-dark .swagger-ui textarea {
          background: #1f2937;
          color: #fff;
          border: 1px solid #374151;
        }
        .swagger-dark .swagger-ui .btn {
          border-radius: 6px;
        }
        .swagger-dark .swagger-ui .btn.execute {
          background: #f97316;
          border-color: #f97316;
        }
        .swagger-dark .swagger-ui .btn.execute:hover {
          background: #ea580c;
        }
        .swagger-dark .swagger-ui .responses-inner {
          background: #0d1117;
        }
        .swagger-dark .swagger-ui .responses-inner h4,
        .swagger-dark .swagger-ui .responses-inner h5 {
          color: #fff !important;
        }
        .swagger-dark .swagger-ui .response-col_status {
          color: #fff !important;
        }
        .swagger-dark .swagger-ui .response-col_description {
          color: #9ca3af !important;
        }
        .swagger-dark .swagger-ui .response .renderedMarkdown p {
          color: #9ca3af !important;
        }
        .swagger-dark .swagger-ui .model-box {
          background: #111827;
        }
        .swagger-dark .swagger-ui section.models {
          border: 1px solid #374151;
          border-radius: 8px;
        }
        .swagger-dark .swagger-ui section.models h4 {
          color: #fff !important;
        }
        .swagger-dark .swagger-ui section.models .model-container {
          background: #111827;
          border-radius: 0;
        }
        .swagger-dark .swagger-ui .model-toggle::after {
          background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E") center no-repeat;
        }
        .swagger-dark .swagger-ui .expand-operation svg,
        .swagger-dark .swagger-ui .expand-methods svg {
          fill: #9ca3af;
        }
        .swagger-dark .swagger-ui .arrow {
          fill: #9ca3af;
        }
        .swagger-dark .swagger-ui .loading-container .loading::after {
          border-color: #f97316 transparent;
        }
        /* Tab styling */
        .swagger-dark .swagger-ui .tab li {
          color: #9ca3af;
        }
        .swagger-dark .swagger-ui .tab li.active {
          color: #fff;
        }
        .swagger-dark .swagger-ui .tab li button.tablinks {
          color: inherit;
        }
        /* Copy button */
        .swagger-dark .swagger-ui .copy-to-clipboard {
          background: #374151;
        }
        .swagger-dark .swagger-ui .copy-to-clipboard button {
          background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Crect x='9' y='9' width='13' height='13' rx='2' ry='2'/%3E%3Cpath d='M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1'/%3E%3C/svg%3E") center no-repeat;
        }
        /* Download buttons */
        .swagger-dark .swagger-ui .download-contents {
          background: #374151;
          color: #fff;
        }
      `}</style>
    </main>
  );
}
