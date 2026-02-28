import { Html, Head, Main, NextScript, type DocumentContext, type DocumentInitialProps } from "next/document";
import Document from "next/document";
import crypto from "crypto";

/**
 * FE-H-03 Remediation: Nonce-based CSP replaces unsafe-inline for scripts.
 *
 * Each SSR request generates a unique nonce. Next.js injects it into its own
 * <script> tags, and the CSP header allows only scripts bearing that nonce.
 * style-src keeps 'unsafe-inline' because Tailwind CSS requires it (acceptable
 * trade-off — XSS via style injection is far lower risk than script injection).
 */
class MintedDocument extends Document {
  static async getInitialProps(ctx: DocumentContext): Promise<DocumentInitialProps & { nonce: string }> {
    const nonce = crypto.randomBytes(16).toString("base64");

    // Inject nonce into response header so Next.js middleware / headers() can reference it
    ctx.res?.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}'`,
        "style-src 'self' 'unsafe-inline'", // Required for Tailwind
        "connect-src 'self' https://*.infura.io wss://*.infura.io https://*.alchemy.com wss://*.alchemy.com",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "frame-ancestors 'none'",
      ].join("; ")
    );

    const initialProps = await Document.getInitialProps(ctx);
    return { ...initialProps, nonce };
  }

  render() {
    const { nonce } = this.props as DocumentInitialProps & { nonce: string };

    return (
      <Html lang="en">
        <Head nonce={nonce}>
          <meta name="description" content="Minted Protocol - Canton-backed mUSD stablecoin" />
          <link rel="icon" href="/favicon.ico" />
        </Head>
        <body>
          <Main />
          <NextScript nonce={nonce} />
        </body>
      </Html>
    );
  }
}

export default MintedDocument;
