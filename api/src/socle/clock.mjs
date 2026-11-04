// Horloge du socle : date du jour locale (AAAA-MM-JJ). `SOCLE_TODAY` fixe la date en recette et en test.
export const today = () => process.env.SOCLE_TODAY ?? new Date().toLocaleDateString('sv-SE');
