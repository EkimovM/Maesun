const FOLDERS = {
  katyushi: {
    category: 'Катюши',
    id: '1RAhjazW8RAhgIBCfDnspZFNWou5NF3IX',
  },
  restaurant: {
    category: 'Ресторан',
    id: '1UoH1K-ZVfDbShyuUymApT9C42jY2gsmk',
  },
  portfolio: {
    category: 'Портфолио',
    id: '1TcSm3kFP45uS_zAOpHIlyYEJsO8o5uUA',
  },
};

const GOOGLE_URL = 'https://www.googleapis.com/drive/v3/files';
const MAX_PAGE_SIZE = 100;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, s-maxage=300, stale-while-revalidate=86400',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function clampPageSize(value) {
  const parsed = Number.parseInt(value || '100', 10);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(MAX_PAGE_SIZE, Math.max(1, parsed));
}

function buildAssetUrls(file) {
  const resourceKey = file.resourceKey
    ? `&resourcekey=${encodeURIComponent(file.resourceKey)}`
    : '';
  const id = encodeURIComponent(file.id);
  const thumbnail = (width) =>
    `https://drive.google.com/thumbnail?id=${id}&sz=w${width}${resourceKey}`;

  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    createdTime: file.createdTime || null,
    modifiedTime: file.modifiedTime || null,
    resourceKey: file.resourceKey || null,
    width: file.imageMediaMetadata?.width || null,
    height: file.imageMediaMetadata?.height || null,
    srcSmall: thumbnail(480),
    src: thumbnail(760),
    srcLarge: thumbnail(1100),
    large: thumbnail(1800),
    download: `https://drive.google.com/uc?export=download&id=${id}${resourceKey}`,
  };
}

export default {
  async fetch(request) {
    if (request.method !== 'GET') {
      return json({ error: 'Method not allowed' }, 405, { allow: 'GET' });
    }

    const apiKey = process.env.GOOGLE_DRIVE_API_KEY;
    if (!apiKey) {
      return json({
        error: 'Server is not configured: GOOGLE_DRIVE_API_KEY is missing.',
      }, 500, { 'cache-control': 'no-store' });
    }

    const url = new URL(request.url);
    const folderKey = url.searchParams.get('folder') || '';
    const folder = FOLDERS[folderKey];
    if (!folder) {
      return json({ error: 'Unknown folder.' }, 400, { 'cache-control': 'no-store' });
    }

    const pageSize = clampPageSize(url.searchParams.get('pageSize'));
    const pageToken = url.searchParams.get('pageToken') || '';

    const params = new URLSearchParams({
      q: `'${folder.id}' in parents and trashed = false and mimeType contains 'image/'`,
      fields: 'nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,resourceKey,imageMediaMetadata(width,height))',
      orderBy: 'createdTime desc',
      pageSize: String(pageSize),
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
    });

    if (pageToken) params.set('pageToken', pageToken);

    const response = await fetch(`${GOOGLE_URL}?${params.toString()}`, {
      headers: {
        accept: 'application/json',
        'x-goog-api-key': apiKey,
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return json({
        error: 'Google Drive API request failed.',
        status: response.status,
        detail: body.slice(0, 500),
      }, 502, { 'cache-control': 'no-store' });
    }

    const data = await response.json();
    return json({
      category: folder.category,
      files: (data.files || []).map(buildAssetUrls),
      nextPageToken: data.nextPageToken || null,
    });
  },
};
