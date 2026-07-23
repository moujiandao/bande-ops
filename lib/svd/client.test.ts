import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { HttpSvdClient } from './client';

const CONFIG = {
  baseUrl: 'https://svdirect.us',
  username: 'user',
  password: 'secret',
};

const LOGIN_PAGE = `
  <form id="Login2" name="Login2" method="post"
        action="../oecart/CustLoginSubmit.asp?Noside=&CheckOut=&PmSess1=397&LoginBtn=">
    <input name="username"><input type="password" name="password">
    <input type="submit" name="btnLogin" value="Submit">
  </form>
`;

const OFFER_LIST = `
  <td id='IDData1' class='clsOffData clsIDData'>widget</td>
  <td id='DESCData1' class='clsOffData clsDESCData'>A widget</td>
  <td id='AvailData1' class='clsOffData clsAvailData'>4</td>
`;

function redirect(location: string, setCookie?: string): Response {
  const headers = new Headers({ location });
  if (setCookie) headers.append('set-cookie', setCookie);
  return new Response('', { status: 302, headers });
}

function page(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
}

/**
 * The real site bootstraps a session across two redirects (allocating a
 * PmSess1 and setting cookies) before it will render the login form.
 */
function happyPathFetch() {
  return vi
    .fn()
    .mockResolvedValueOnce(
      redirect('https://svdirect.us/sv5fmsnet/oe.asp?Pos=MBasic&V=2', 'ASPSESSIONID=abc'),
    )
    .mockResolvedValueOnce(redirect('Oe2.asp?PMSess1=397', 'PMOrder397=1'))
    .mockResolvedValueOnce(redirect('OeCart/OeFrame.asp?PmSess1=397&Action=LOGIN'))
    .mockResolvedValueOnce(page(LOGIN_PAGE))
    .mockResolvedValueOnce(page(OFFER_LIST));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HttpSvdClient', () => {
  it('bootstraps a session, logs in, and returns the offer-list HTML', async () => {
    const fetchMock = happyPathFetch();
    vi.stubGlobal('fetch', fetchMock);

    const html = await new HttpSvdClient(CONFIG).fetchInventoryHtml();

    expect(html).toContain('clsIDData');

    const loginCall = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    // Posts to the submit handler named by the form, not the login page.
    expect(String(loginCall[0])).toContain('CustLoginSubmit.asp');
    // Carries the server-allocated session id, which the old client never sent.
    expect(String(loginCall[0])).toContain('PmSess1=397');
    expect(loginCall[1].method).toBe('POST');
    expect(String(loginCall[1].body)).toContain('username=user');
  });

  it('sends the session cookies gathered during bootstrap', async () => {
    const fetchMock = happyPathFetch();
    vi.stubGlobal('fetch', fetchMock);

    await new HttpSvdClient(CONFIG).fetchInventoryHtml();

    const loginCall = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    const cookie = (loginCall[1].headers as Record<string, string>).cookie ?? '';
    expect(cookie).toContain('ASPSESSIONID=abc');
    expect(cookie).toContain('PMOrder397=1');
  });

  it('throws rather than returning a page that is not the offer list', async () => {
    // A logged-out or changed page must fail loudly: returning it would parse to
    // zero items and silently overwrite real inventory with nothing.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page(LOGIN_PAGE))
      .mockResolvedValueOnce(page('<html>Invalid username or password</html>'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new HttpSvdClient(CONFIG).fetchInventoryHtml()).rejects.toThrow(
      /offer list/i,
    );
  });

  it('throws when the login form is missing instead of posting blindly', async () => {
    const fetchMock = vi.fn().mockResolvedValue(page('<html>maintenance</html>'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(new HttpSvdClient(CONFIG).fetchInventoryHtml()).rejects.toThrow(
      /login form/i,
    );
  });

  it('never puts credentials in the thrown error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(page('<html>maintenance</html>'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new HttpSvdClient(CONFIG).fetchInventoryHtml(),
    ).rejects.toThrow(expect.not.stringContaining('secret'));
  });
});
