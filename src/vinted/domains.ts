// Vinted country domains. Match patterns cannot wildcard a TLD, so each is listed.
// Only vinted.co.uk has been tested (RESEARCH.md D9).
export const VINTED_HOSTS = [
  'www.vinted.co.uk',
  'www.vinted.fr',
  'www.vinted.de',
  'www.vinted.es',
  'www.vinted.it',
  'www.vinted.nl',
  'www.vinted.be',
  'www.vinted.at',
  'www.vinted.lu',
  'www.vinted.pl',
  'www.vinted.cz',
  'www.vinted.sk',
  'www.vinted.lt',
  'www.vinted.pt',
  'www.vinted.se',
  'www.vinted.dk',
  'www.vinted.fi',
  'www.vinted.hu',
  'www.vinted.ro',
  'www.vinted.hr',
  'www.vinted.gr',
  'www.vinted.ie',
  'www.vinted.com',
];

export const VINTED_MATCHES = VINTED_HOSTS.map((h) => `https://${h}/*`);
