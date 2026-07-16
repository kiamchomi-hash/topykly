function getMascotMarkup(filterId) {
  return `
    <svg viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg" focusable="false">
      <defs>
        <filter id="${filterId}" x="-5%" y="-5%" width="110%" height="110%" color-interpolation-filters="sRGB">
          <feColorMatrix
            in="SourceGraphic"
            result="blueColorMask"
            values="0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 0 0
                   -1 -1 2 0 0"
          />
          <feComposite in="blueColorMask" in2="SourceAlpha" operator="in" result="blueMask" />
          <feColorMatrix in="SourceGraphic" result="luminance" type="saturate" values="0" />
          <feFlood flood-color="var(--mascot-accent)" result="paletteColor" />
          <feBlend in="paletteColor" in2="luminance" mode="multiply" result="shadedPalette" />
          <feComposite in="shadedPalette" in2="blueMask" operator="in" result="recoloredBody" />
          <feComposite in="SourceGraphic" in2="blueMask" operator="out" result="neutralDetails" />
          <feMerge>
            <feMergeNode in="neutralDetails" />
            <feMergeNode in="recoloredBody" />
          </feMerge>
        </filter>
      </defs>
      <image
        class="topykly-mascot__approved-art"
        href="/assets/mascot/topy-concept-v8.png"
        width="1200"
        height="1200"
        preserveAspectRatio="xMidYMid meet"
        filter="url(#${filterId})"
      />
      <g class="topykly-mascot__neutral-face" fill="#000">
        <circle cx="472.2" cy="531.6" r="40.5" />
        <circle cx="710.5" cy="531.6" r="40.5" />
        <path
          d="M457.4 653.6C528.2 722.5 666 722.5 735 651.7"
          fill="none"
          stroke="#000"
          stroke-width="14"
          stroke-linecap="round"
        />
      </g>
    </svg>
  `;
}

export function createTopyklyMascot(extraClass = "", documentRef = document) {
  const mascot = documentRef.createElement("span");
  const placementId = extraClass.replace(/[^a-z0-9]+/gi, "-") || "default";
  const filterId = `topykly-mascot-palette-${placementId}`;
  mascot.className = ["topykly-mascot", extraClass].filter(Boolean).join(" ");
  mascot.setAttribute("aria-hidden", "true");
  mascot.innerHTML = getMascotMarkup(filterId);
  return mascot;
}
