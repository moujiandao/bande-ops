import 'server-only';

import { getSvdConfig, type SvdConfig } from './config';

export interface SvdClient {
  fetchInventoryHtml(): Promise<string>;
}

/**
 * Entry point that starts a session. Hitting the login page directly does not
 * work: the server allocates the PmSess1 session id across two redirects from
 * here, and the login form embeds that id in its submit URL.
 */
const ENTRY_PATH = '/sv5fmsnet/oe.asp?Pos=MBasic&V=2';

/** The login form is the only one on the page named Login2. */
const LOGIN_FORM_PATTERN =
  /<form[^>]*name=["']Login2["'][^>]*action=["']([^"']+)["']/i;

/**
 * Cell marker present on every offer row. Used as the proof that login
 * actually landed on the offer list rather than back on a login or error page.
 */
const OFFER_LIST_MARKER = /clsIDData/;

const MAX_REDIRECTS = 8;

/**
 * Scrapes the SVD replenishment stock list.
 *
 * SVD is a classic ASP order-entry site, not an API: it needs a bootstrapped
 * session, cookies carried across redirects, and a form post to a submit
 * handler that is *not* the page the form is displayed on. Read-only — this
 * client never adds to a cart or places an order.
 */
export class HttpSvdClient implements SvdClient {
  constructor(private readonly config: SvdConfig = getSvdConfig()) {}

  /** Cookies accumulated across the session (ASPSESSIONID + PMOrder<sess>). */
  private readonly jar = new Map<string, string>();

  private cookieHeader(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private storeCookies(res: Response): void {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  /**
   * Fetch following redirects manually, so cookies set on each hop are carried
   * to the next. `redirect: 'follow'` would drop them.
   */
  private async request(
    url: URL,
    init: RequestInit = {},
  ): Promise<{ url: URL; html: string }> {
    let current = url;
    let nextInit = init;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await fetch(current, {
        ...nextInit,
        headers: {
          ...(this.jar.size ? { cookie: this.cookieHeader() } : {}),
          ...(nextInit.headers ?? {}),
        },
        redirect: 'manual',
        cache: 'no-store',
      });
      this.storeCookies(res);

      const location = res.headers.get('location');
      if (!location) {
        if (!res.ok) {
          throw new Error(`SVD request failed: ${res.status} ${res.statusText}`);
        }
        return { url: current, html: await res.text() };
      }

      current = new URL(location, current);
      nextInit = {}; // A redirect is always followed as a GET with no body.
    }

    throw new Error('SVD request exceeded the redirect limit.');
  }

  async fetchInventoryHtml(): Promise<string> {
    const origin = this.config.baseUrl;

    // 1. Bootstrap: land on the login page with a session id and cookies.
    const login = await this.request(new URL(ENTRY_PATH, origin));

    const action = LOGIN_FORM_PATTERN.exec(login.html)?.[1];
    if (!action) {
      throw new Error(
        'SVD login form not found — the site layout may have changed.',
      );
    }

    // 2. Submit credentials to the handler the form names, resolved against the
    //    login page URL so the form's relative "../oecart/..." works.
    const submitUrl = new URL(action, login.url);
    const result = await this.request(submitUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        username: this.config.username,
        password: this.config.password,
        btnLogin: 'Submit',
        hdnGuest: '',
        hdnViewAttach: '',
      }),
    });

    // 3. Prove we reached the offer list. A logged-out or error page parses to
    //    zero items, which would silently overwrite real stock with nothing —
    //    so fail loudly and let the sync record a failure instead.
    if (!OFFER_LIST_MARKER.test(result.html)) {
      throw new Error(
        'SVD login did not reach the offer list — check SVD_USERNAME / SVD_PASSWORD.',
      );
    }

    return result.html;
  }
}
