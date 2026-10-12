/// Sacar el ASIN (código de producto de Amazon) de un enlace de libro.
/// Solo se acepta un enlace largo de Amazon (amazon.es, .com, .co.uk…): los
/// cortos (amzn.to) no se pueden resolver sin abrirlos.
const HOST_AMAZON = /(^|\.)amazon\.(es|com|co\.uk|de|fr|it|com\.mx)$/i;
const ASIN = /\/(?:dp|gp\/product|gp\/aw\/d|d|exec\/obidos\/ASIN)\/([A-Z0-9]{10})(?:[/?#]|$)/i;

export function extraerAsin(enlace: string): string | null {
  let url: URL;
  try {
    url = new URL(enlace.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !HOST_AMAZON.test(url.hostname)) return null;
  const coincidencia = ASIN.exec(url.pathname);
  return coincidencia ? coincidencia[1]!.toUpperCase() : null;
}

/// Los ASIN que empiezan por B0 son casi siempre ediciones Kindle; los
/// numéricos (ISBN-10) son libros en papel.
export function formatoDeAsin(asin: string): 'ebook' | 'papel' {
  return /^B0/i.test(asin) ? 'ebook' : 'papel';
}
