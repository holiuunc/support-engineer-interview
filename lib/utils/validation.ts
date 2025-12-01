/**
 * Validates a credit card number using the Luhn algorithm
 * @param cardNumber - The card number to validate (can include spaces or dashes)
 * @returns true if the card number is valid, false otherwise
 */
export function isValidLuhn(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, "");
  let sum = 0;
  let isEven = false;

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10);

    if (isEven) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    isEven = !isEven;
  }

  return sum % 10 === 0;
}

/**
 * Detects the card type based on the card number prefix
 * @param cardNumber - The card number to check
 * @returns The detected card type or null if unknown
 */
export function detectCardType(cardNumber: string): "visa" | "mastercard" | "amex" | "discover" | null {
  const digits = cardNumber.replace(/\D/g, "");

  // Visa: starts with 4
  if (digits.startsWith("4")) {
    return "visa";
  }

  // Mastercard: 51-55 or 2221-2720
  if (/^5[1-5]/.test(digits)) {
    return "mastercard";
  }
  const first4 = parseInt(digits.substring(0, 4), 10);
  if (first4 >= 2221 && first4 <= 2720) {
    return "mastercard";
  }

  // Amex: 34 or 37 (15 digits)
  if (/^3[47]/.test(digits) && digits.length === 15) {
    return "amex";
  }

  // Discover: 6011, 622126-622925, 644-649, 65
  if (digits.startsWith("6011")) {
    return "discover";
  }
  const first6 = parseInt(digits.substring(0, 6), 10);
  if (first6 >= 622126 && first6 <= 622925) {
    return "discover";
  }
  const first3 = parseInt(digits.substring(0, 3), 10);
  if (first3 >= 644 && first3 <= 649) {
    return "discover";
  }
  if (digits.startsWith("65")) {
    return "discover";
  }

  return null;
}

/**
 * Validates if a card number matches a known card type
 * @param cardNumber - The card number to validate
 * @returns true if the card type is recognized, false otherwise
 */
export function isValidCardType(cardNumber: string): boolean {
  return detectCardType(cardNumber) !== null;
}
