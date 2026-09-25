// Mock data for the prototypes. Clips are fetched by ../fetch-media.mjs.
// Rewards stay under the AU ceiling of 8 pts per minute, bonus included; prices
// are what the server would compute at about 3¢ a point.

export type Variant = "after-dark" | "daylight";
export type Theme = "light" | "dark";
export type Orientation = "vertical" | "horizontal";

export interface Channel {
  name: string;
  initials: string;
  /** Avatar fill; the initials are always white on it. */
  hue: string;
}

export interface Question {
  prompt: string;
  options: string[];
  answer: number;
}

/** A long-form campaign: one question at a server-chosen moment. */
export interface Campaign {
  clip: string;
  orientation: Orientation;
  channel: Channel;
  title: string;
  durationLabel: string;
  rewardPts: number;
  bonusPts: number;
  /** Seconds into the clip, after the fact it asks about. The server picks it in the real flow. */
  questionAt: number;
  question: Question;
}

export interface FeedItem {
  id: string;
  /** The teaser that plays in the feed. */
  clip: string;
  orientation: Orientation;
  channel: Channel;
  title: string;
  durationLabel: string;
  /** The most this item can earn, bonus included. */
  rewardPts: number;
  /** Absent for Quick (under 60 s): swipe, watch, earn, no question. */
  campaign?: Campaign;
}

export const CHANNELS = {
  harbour: { name: "Harbour Roasters", initials: "HR", hue: "#7c3a1d" },
  crumb: { name: "Crumb & Co", initials: "CC", hue: "#9a3412" },
  saltwater: { name: "Saltwater Surf", initials: "SS", hue: "#0e7490" },
  stride: { name: "Stride Sneakers", initials: "ST", hue: "#3f3f46" },
  fern: { name: "Fern & Pot", initials: "FP", hue: "#166534" },
  trattoria: { name: "Nonna's Trattoria", initials: "NT", hue: "#991b1b" },
} satisfies Record<string, Channel>;

export const LONG_FORM: Campaign = {
  clip: "pasta",
  orientation: "horizontal",
  channel: CHANNELS.trattoria,
  title: "Inside the kitchen: fresh pasta, every afternoon",
  durationLabel: "5:30",
  rewardPts: 27,
  bonusPts: 6,
  questionAt: 7,
  question: {
    prompt: "How long does the ragù simmer?",
    options: ["Two hours", "Four hours", "Six hours", "Overnight"],
    answer: 2,
  },
};

const coffee: Campaign = {
  clip: "coffee-pour",
  orientation: "vertical",
  channel: CHANNELS.harbour,
  title: "How we brew the perfect long black",
  durationLabel: "4:12",
  rewardPts: 20,
  bonusPts: 5,
  questionAt: 5,
  question: {
    prompt: "Which day are the beans roasted?",
    options: ["Monday", "Tuesday", "Friday", "Sunday"],
    answer: 1,
  },
};

const pastries: Campaign = {
  clip: "pastries",
  orientation: "vertical",
  channel: CHANNELS.crumb,
  title: "7 am, straight from the oven",
  durationLabel: "2:40",
  rewardPts: 13,
  bonusPts: 3,
  questionAt: 5,
  question: {
    prompt: "When do the pastries come out of the oven?",
    options: ["6 am", "7 am", "8 am", "9 am"],
    answer: 1,
  },
};

const plants: Campaign = {
  clip: "plants",
  orientation: "vertical",
  channel: CHANNELS.fern,
  title: "Plants that love a dark flat",
  durationLabel: "3:05",
  rewardPts: 15,
  bonusPts: 3,
  questionAt: 5,
  question: {
    prompt: "What comes free with any pot?",
    options: ["Repotting", "Delivery", "A bag of soil", "A cutting"],
    answer: 0,
  },
};

function teaser(id: string, clip: string, orientation: Orientation, campaign: Campaign): FeedItem {
  const { channel, title, durationLabel, rewardPts, bonusPts } = campaign;
  return {
    id,
    clip,
    orientation,
    channel,
    title,
    durationLabel,
    rewardPts: rewardPts + bonusPts,
    campaign,
  };
}

function quick(id: string, clip: string, channel: Channel, title: string, secs: number): FeedItem {
  return {
    id,
    clip,
    orientation: "vertical",
    channel,
    title,
    durationLabel: `0:${String(secs).padStart(2, "0")}`,
    rewardPts: 1,
  };
}

export const FEED: FeedItem[] = [
  teaser("f1", "kitchen", "horizontal", LONG_FORM),
  quick("f2", "surf", CHANNELS.saltwater, "Dawn patrol at Bondi", 10),
  quick("f3", "sneakers", CHANNELS.stride, "Laced up in recycled bottles", 9),
  teaser("f4", "coffee-pour", "vertical", coffee),
  teaser("f5", "pastries", "vertical", pastries),
  quick("f6", "cake", CHANNELS.crumb, "Piping a birthday cake", 19),
  teaser("f7", "plants", "vertical", plants),
];

export interface Listing {
  id: string;
  poster: string;
  channel: Channel;
  title: string;
  pricePts: number;
}

export const LISTINGS: Listing[] = [
  {
    id: "l1",
    poster: "coffee-pour",
    channel: CHANNELS.harbour,
    title: "Any coffee",
    pricePts: 170,
  },
  {
    id: "l2",
    poster: "pastries",
    channel: CHANNELS.crumb,
    title: "Almond croissant",
    pricePts: 190,
  },
  {
    id: "l3",
    poster: "surf",
    channel: CHANNELS.saltwater,
    title: "1 h board hire",
    pricePts: 1000,
  },
  { id: "l4", poster: "plants", channel: CHANNELS.fern, title: "Free repotting", pricePts: 330 },
  {
    id: "l5",
    poster: "kitchen",
    channel: CHANNELS.trattoria,
    title: "Garlic bread",
    pricePts: 270,
  },
  { id: "l6", poster: "sneakers", channel: CHANNELS.stride, title: "Lace pack", pricePts: 400 },
];

export interface Voucher {
  id: string;
  channel: Channel;
  title: string;
  code: string;
  validUntil: string;
}

export const VOUCHERS: Voucher[] = [
  {
    id: "v1",
    channel: CHANNELS.harbour,
    title: "Any coffee",
    code: "HR7K-3P9Q",
    validUntil: "31 Oct",
  },
  {
    id: "v2",
    channel: CHANNELS.crumb,
    title: "Almond croissant",
    code: "CC2M-8XWD",
    validUntil: "14 Nov",
  },
];

export const START_BALANCE = 1240;
export const STREAK_DAYS = 3;
/** The date shown on the earn moment, as if the points were held for 72 h. */
export const UNLOCKS_ON = "28 Sep";

export const media = (slug: string, ext: "mp4" | "jpg" | "vtt") => `/lab-media/${slug}.${ext}`;
