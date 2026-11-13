// The Studio's small release-layer icons (`RingIcon`, `CircleSmallIcon`, `BoltSmallIcon`,
// `ClockSmallIcon`, `UnknownSmallIcon` in `sanity@6.23`), copied verbatim because `sanity` does not
// export them. `data-sanity-icon` makes Sanity UI's `Text` size them like its own icons.
import type {SVGProps} from 'react'

type IconProps = SVGProps<SVGSVGElement>

function SmallIcon({name, children, ...rest}: IconProps & {name: string}) {
  return (
    <svg
      data-sanity-icon={name}
      width="1em"
      height="1em"
      viewBox="0 0 25 25"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** Drafts. */
export function RingIcon(props: IconProps) {
  return (
    <SmallIcon name="ring" {...props}>
      <circle cx={12.5} cy={12.5} r={2.9} stroke="currentColor" strokeWidth={1.2} />
    </SmallIcon>
  )
}

/** Published. */
export function CircleSmallIcon(props: IconProps) {
  return (
    <SmallIcon name="circle-small" {...props}>
      <circle cx={12.5} cy={12.5} r={3.5} fill="currentColor" />
    </SmallIcon>
  )
}

/** ASAP release. */
export function BoltSmallIcon(props: IconProps) {
  return (
    <SmallIcon name="bolt-small" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M14.2496 6.64408C14.4167 6.52722 14.642 6.51898 14.818 6.63334C15.0184 6.76424 15.0999 7.01941 15.0143 7.24271L13.5797 10.9722H16.9283L16.9889 10.9771H16.9957C17.0202 10.9808 17.0448 10.9873 17.069 10.9947C17.2111 11.0383 17.3312 11.1433 17.3903 11.2857C17.4686 11.4754 17.4242 11.6935 17.2799 11.8384L10.8199 18.2984C10.7565 18.3618 10.6785 18.4063 10.5963 18.4292C10.5688 18.4369 10.5408 18.4419 10.5133 18.4449C10.457 18.4508 10.3992 18.4472 10.3434 18.4341C10.2873 18.4209 10.2329 18.398 10.1832 18.3658C10.0324 18.2676 9.94891 18.1 9.95275 17.9283C9.95408 17.8711 9.96557 17.813 9.98693 17.7574L11.4215 14.0269H8.08068C7.87549 14.0269 7.68973 13.9041 7.61095 13.7144C7.53245 13.5245 7.5764 13.3057 7.72131 13.1607L14.1813 6.70072L14.2496 6.64408ZM9.30529 13.0122H12.1676L12.2174 13.0152L12.2223 13.0162C12.3651 13.0338 12.4957 13.1114 12.5787 13.232C12.6615 13.3526 12.6878 13.5029 12.6529 13.6431L12.6344 13.7027L11.7926 15.8882L15.6949 11.9878H12.8404C12.8215 11.9878 12.7999 11.9866 12.7779 11.9839C12.7366 11.9788 12.6968 11.9687 12.6598 11.9546C12.6222 11.9403 12.5859 11.9211 12.5524 11.898C12.5181 11.8744 12.4875 11.8464 12.4606 11.816C12.4468 11.8004 12.4341 11.784 12.4225 11.7671C12.3278 11.6293 12.3069 11.4535 12.3668 11.2974L13.2076 9.10892L9.30529 13.0122Z"
        fill="currentColor"
      />
    </SmallIcon>
  )
}

/** Release at a scheduled time. */
export function ClockSmallIcon(props: IconProps) {
  return (
    <SmallIcon name="clock-small" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M13.1074 12.248L15.1113 14.252L14.252 15.1113L12.0703 12.9297C11.9565 12.8158 11.8926 12.6614 11.8926 12.5V9.24023H13.1074V12.248Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12.5 6.79199C15.6524 6.79203 18.208 9.34762 18.208 12.5C18.208 15.6524 15.6524 18.208 12.5 18.208C9.34762 18.208 6.79203 15.6524 6.79199 12.5C6.79203 9.34762 9.34762 6.79203 12.5 6.79199ZM12.5 8.00781C10.0192 8.00785 8.00785 10.0192 8.00781 12.5C8.00785 14.9808 10.0192 16.9921 12.5 16.9922C14.9808 16.9921 16.9921 14.9808 16.9922 12.5C16.9921 10.0192 14.9808 8.00785 12.5 8.00781Z"
        fill="currentColor"
      />
    </SmallIcon>
  )
}

/** Undecided release. */
export function UnknownSmallIcon(props: IconProps) {
  return (
    <SmallIcon name="unknown-small" {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M13.1074 15.0801H11.8916V13.6602H13.1074V15.0801Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12.5 9.17188C13.6047 9.17201 14.1278 10.1145 14.1279 10.7998C14.1279 11.1692 14.0317 11.4666 13.8545 11.7129C13.7017 11.925 13.4919 12.0813 13.3984 12.1592C13.2853 12.2535 13.2311 12.3108 13.1924 12.3818C13.1555 12.4495 13.1075 12.5788 13.1074 12.8398V13.04H11.8916C11.8916 13.04 11.8916 13.2582 11.8916 12.8398C11.8916 12.4215 11.9716 12.0828 12.126 11.7998C12.2782 11.5208 12.4788 11.3442 12.6211 11.2256C12.785 11.089 12.829 11.0549 12.8672 11.002C12.8775 10.9875 12.8866 10.9709 12.8945 10.9453C12.903 10.9177 12.9121 10.8727 12.9121 10.7998C12.912 10.6017 12.7625 10.3878 12.5 10.3877C12.284 10.3877 12.1354 10.4353 12.0049 10.5137C11.8662 10.597 11.7401 10.7188 11.5693 10.8896L11.4277 11.0312L10.71 10.3125L10.5684 10.1719L10.71 10.0303C11.0564 9.68383 11.5529 9.17196 12.5 9.17188Z"
        fill="currentColor"
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M17.2598 7.13184C17.5955 7.13184 17.8671 7.40455 17.8672 7.74023V17.2598C17.8672 17.5956 17.5956 17.8672 17.2598 17.8672H7.74023C7.40455 17.8671 7.13184 17.5955 7.13184 17.2598V7.74023C7.13196 7.40463 7.40463 7.13196 7.74023 7.13184H17.2598ZM8.34766 16.6523H16.6523V8.34766H8.34766V16.6523Z"
        fill="currentColor"
      />
    </SmallIcon>
  )
}
