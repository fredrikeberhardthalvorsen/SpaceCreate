// Major moons of each planet: real mean radius (km) and real orbital
// semi-major axis (km). Mercury and Venus have none. Hundreds of tiny
// sub-kilometre moonlets are omitted — they'd be invisible at any sane scale.
// [name, radiusKm, smaKm, tintHex]
export const MOONS = {
  Earth: [
    ['Moon', 1737, 384400, 0x9a9a9a],
  ],
  Mars: [
    ['Phobos', 11, 9376, 0x8a7a6a],
    ['Deimos', 6, 23463, 0x9a8a78],
  ],
  Jupiter: [
    ['Io',       1821, 421700,  0xd9c878],
    ['Europa',   1561, 671034,  0xcfc2a8],
    ['Ganymede', 2634, 1070412, 0x9a8f80],
    ['Callisto', 2410, 1882709, 0x6f6256],
  ],
  Saturn: [
    ['Mimas',     198, 185539,  0xbfbfbf],
    ['Enceladus', 252, 237948,  0xf2f4f6],
    ['Tethys',    531, 294619,  0xcfd0cf],
    ['Dione',     561, 377396,  0xc7c4ba],
    ['Rhea',      764, 527108,  0xc2bdb2],
    ['Titan',    2575, 1221870, 0xd9a05a],
    ['Iapetus',   735, 3560820, 0x7a6a55],
  ],
  Uranus: [
    ['Miranda', 236, 129390, 0x9fb0b3],
    ['Ariel',   579, 191020, 0xb9c3c4],
    ['Umbriel', 585, 266000, 0x7e8a8c],
    ['Titania', 789, 435910, 0xb0b6b4],
    ['Oberon',  761, 583520, 0x9a9b96],
  ],
  Neptune: [
    ['Proteus', 210, 117647, 0x8c8c8c],
    ['Triton', 1353, 354759, 0xcdbfae],
    ['Nereid',  170, 5513400, 0x9a9488],
  ],
};
