// The prototype's stock clips. `slug` is the file name under /lab-media/; the
// mock data in lab-data.ts refers to clips by slug. `posterAt` is in seconds.
const pexels = (id, file, page) => ({
  url: `https://videos.pexels.com/video-files/${id}/${id}-${file}.mp4`,
  page: `https://www.pexels.com/video/${page}-${id}/`,
});

export const CLIPS = [
  {
    slug: "coffee-pour",
    ...pexels(6963730, "sd_540_960_24fps", "pouring-coffee-on-ceramic-cup"),
    posterAt: 6,
    captions: ["Single origin, roasted on Tuesdays", "Oat milk at no extra charge"],
  },
  {
    slug: "pastries",
    ...pexels(5930359, "sd_540_960_30fps", "freshly-baked-pastries-on-bakery-tray"),
    captions: ["Out of the oven at 7 every morning", "Almond croissants sell out by 10"],
  },
  {
    slug: "cake",
    ...pexels(8478148, "sd_540_960_24fps", "a-pastry-chef-decorating-a-cake"),
    captions: ["Birthday cakes with two days' notice", "Every cake is decorated by hand"],
  },
  {
    slug: "surf",
    ...pexels(20151149, "sd_540_960_30fps", "surfing"),
    captions: ["Boards for hire from the beach shack", "Lessons for beginners every weekend"],
  },
  {
    slug: "sneakers",
    ...pexels(8994347, "sd_540_960_25fps", "a-person-putting-on-a-shoe"),
    posterAt: 6,
    captions: ["Made from recycled bottles", "Free resoling for a year"],
  },
  {
    slug: "plants",
    ...pexels(9411405, "sd_540_960_24fps", "a-woman-is-working-on-a-potted-plant"),
    captions: ["Repotting is free with any pot", "Ask us which plants suit low light"],
  },
  {
    slug: "pasta",
    ...pexels(12691834, "sd_960_540_30fps", "two-people-plating-pasta"),
    captions: [
      "Fresh pasta is rolled every afternoon",
      "The ragù simmers for six hours",
      "Plates go out within twelve minutes",
      "Every dish can be made gluten free",
    ],
  },
  {
    slug: "kitchen",
    ...pexels(854565, "sd_960_540_25fps", "cooking-with-style"),
    captions: ["Our kitchen opens at five", "Book the chef's table for six"],
  },
];
