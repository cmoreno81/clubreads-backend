/**
 * Nivel "picante" opcional (1-5 guindillas). A diferencia de la valoración
 * por estrellas, nunca es obligatorio: ausente/0 significa "sin especificar",
 * no "nota mínima".
 */
export function spicyFromFlutter(value?: string | number | null): number | null {
  const texto = String(value ?? '').trim();

  if (!texto) {
    return null;
  }

  const numero = Number(texto);

  if (!Number.isInteger(numero) || numero < 1 || numero > 5) {
    return null;
  }

  return numero;
}

export function spicyToFlutter(value?: number | null): string {
  if (value == null || value <= 0) {
    return '';
  }

  return '🌶️'.repeat(Math.min(5, Math.round(value)));
}
