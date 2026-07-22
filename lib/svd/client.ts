import 'server-only';

import { getSvdConfig, type SvdConfig } from './config';

export interface SvdClient {
  fetchInventoryHtml(): Promise<string>;
}

export class HttpSvdClient implements SvdClient {
  constructor(private readonly config: SvdConfig = getSvdConfig()) {}

  async fetchInventoryHtml(): Promise<string> {
    const loginRes = await fetch(
      `${this.config.baseUrl}/sv5fmsnet/OeCart/OEFrame.asp`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          login: this.config.username,
          password: this.config.password,
        }),
        cache: 'no-store',
      },
    );
    if (!loginRes.ok) {
      throw new Error(`SVD login failed: ${loginRes.status}`);
    }

    const cookie = loginRes.headers.get('set-cookie') ?? '';
    const reportRes = await fetch(
      `${this.config.baseUrl}/sv5fmsnet/OeCart/OEFrame.asp?Action=NEWORDER`,
      {
        headers: cookie ? { cookie } : undefined,
        cache: 'no-store',
      },
    );
    if (!reportRes.ok) {
      throw new Error(`SVD inventory fetch failed: ${reportRes.status}`);
    }

    return reportRes.text();
  }
}
