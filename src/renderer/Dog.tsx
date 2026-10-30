export function Dog({
  state = "idle",
  small = false,
}: {
  state?: "idle" | "thinking" | "done";
  small?: boolean;
}) {
  return (
    <svg
      className={`dog dog-${state} ${small ? "dog-small" : ""}`}
      viewBox="0 0 240 210"
      fill="none"
      role="img"
      aria-label={
        state === "thinking"
          ? "狗狗正在分析"
          : state === "done"
            ? "狗狗完成复盘"
            : "陪你工作的狗狗"
      }
    >
      <ellipse cx="120" cy="192" rx="65" ry="9" fill="#e6ddce" />
      <path
        className="dog-tail"
        d="M168 160Q218 152 192 121Q185 137 166 138"
        fill="#cf8b4c"
        stroke="#523c2b"
        strokeWidth="3"
      />
      <path
        d="M77 143Q70 108 119 108Q166 109 165 156L173 184Q158 195 143 184L136 169H103L98 187Q80 194 70 182Z"
        fill="#eab477"
        stroke="#523c2b"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M97 143Q120 128 143 145L140 179H100Z" fill="#fff3dc" />
      <path
        className="dog-ear left"
        d="M77 53Q34 24 38 79Q39 111 66 112L85 76"
        fill="#b67742"
        stroke="#523c2b"
        strokeWidth="3"
      />
      <path
        className="dog-ear right"
        d="M163 52Q206 26 202 81Q199 109 174 112L154 75"
        fill="#b67742"
        stroke="#523c2b"
        strokeWidth="3"
      />
      <path
        d="M58 88Q57 36 118 34Q180 34 182 89Q185 142 120 148Q55 145 58 88Z"
        fill="#eab477"
        stroke="#523c2b"
        strokeWidth="3"
      />
      <path
        d="M112 37Q94 65 103 89Q66 91 73 116Q81 141 121 143Q163 139 168 115Q175 91 137 88Q145 64 127 36"
        fill="#fff3dc"
      />
      {state === "done" ? (
        <g stroke="#523c2b" strokeWidth="4" strokeLinecap="round">
          <path d="M80 84q7-10 14 0M147 84q7-10 14 0" />
        </g>
      ) : (
        <g fill="#523c2b">
          <ellipse className="dog-eye" cx="88" cy="81" rx="5" ry="7" />
          <ellipse className="dog-eye" cx="153" cy="81" rx="5" ry="7" />
          <circle cx="89" cy="79" r="1.5" fill="white" />
          <circle cx="154" cy="79" r="1.5" fill="white" />
        </g>
      )}
      <ellipse cx="76" cy="100" rx="9" ry="5" fill="#e99b80" opacity=".55" />
      <ellipse cx="164" cy="100" rx="9" ry="5" fill="#e99b80" opacity=".55" />
      <path
        d="M110 101Q121 95 132 101Q131 112 121 114Q111 111 110 101Z"
        fill="#523c2b"
      />
      <path
        d="M121 114v8m0-1q-10 9-17 0m17 0q10 9 17 0"
        stroke="#523c2b"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path d="M78 144Q121 162 164 144" stroke="#58705b" strokeWidth="10" />
      <path
        d="M114 151h15v16l-8 6-7-6Z"
        fill="#e4b359"
        stroke="#523c2b"
        strokeWidth="2"
      />
      {state === "thinking" && (
        <g className="thinking-dots" fill="#748873">
          <circle cx="197" cy="34" r="4" />
          <circle cx="212" cy="23" r="5" />
          <circle cx="227" cy="10" r="6" />
        </g>
      )}
      {state === "done" && (
        <path d="m205 43 4-11 4 11 11 4-11 4-4 11-4-11-11-4Z" fill="#d6a454" />
      )}
    </svg>
  );
}
