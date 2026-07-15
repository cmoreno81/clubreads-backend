export function ratingFromFlutter(
  value?: string | number | null,
): number | null {
  const texto = String(value ?? '')
    .trim()
    .replaceAll('⭐️', '⭐')
    .replace(',', '.');

  if (!texto) {
    return null;
  }

  if (texto === '😞') {
    return 0;
  }

  /*
   * La nueva APK enviará valores como:
   * 0.5, 1, 1.5, 2... 5
   */
  const numeroDirecto = Number(texto);

  if (!Number.isNaN(numeroDirecto)) {
    return _validarRating(numeroDirecto);
  }

  /*
   * Compatibilidad con la APK actual:
   * ⭐⭐⭐
   *
   * Y con el nuevo formato visual:
   * ⭐⭐⭐½
   */
const estrellasCompletas =
  texto.match(/⭐/g)?.length ?? 0;
  
  const tieneMedia =
    texto.includes('½') ||
    texto.toLowerCase().includes('media');

  if (estrellasCompletas > 0 || tieneMedia) {
    return _validarRating(
      estrellasCompletas + (tieneMedia ? 0.5 : 0),
    );
  }

  return null;
}

export function ratingToFlutter(
  rating?: number | null,
): string {
  if (rating === 0) {
    return '😞';
  }

  if (rating == null || rating <= 0) {
    return '';
  }

  const valor = _redondearMedia(rating);
  const completas = Math.floor(valor);
  const tieneMedia = valor - completas >= 0.5;

  return `${'⭐'.repeat(completas)}${tieneMedia ? '½' : ''}`;
}

function _validarRating(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }

  const redondeado = _redondearMedia(value);

  if (redondeado < 0 || redondeado > 5) {
    return null;
  }

  return redondeado;
}

function _redondearMedia(value: number): number {
  return Math.round(value * 2) / 2;
}