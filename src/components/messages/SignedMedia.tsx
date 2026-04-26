"use client";

import { ImgHTMLAttributes, VideoHTMLAttributes, AudioHTMLAttributes } from "react";
import { useSignedMessageUrl } from "@/hooks/useSignedMessageUrl";

// Thin wrappers for DM media. They resolve the stored URL to a freshly-signed
// one (when the file lives in the private message-media bucket) and render a
// neutral placeholder while the sign request is in flight. URLs that don't
// belong to message-media (e.g. avatars, data: previews) pass through
// unchanged so these can be used as drop-in replacements.

type ImgProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  url: string | null | undefined;
};

export function SignedImage({ url, ...rest }: ImgProps) {
  const resolved = useSignedMessageUrl(url);
  if (!resolved) {
    return <div className={rest.className} style={{ background: "rgba(255,255,255,0.04)" }} />;
  }
  return <img src={resolved} {...rest} />;
}

type VideoProps = Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & {
  url: string | null | undefined;
};

export function SignedVideo({ url, ...rest }: VideoProps) {
  const resolved = useSignedMessageUrl(url);
  if (!resolved) {
    return <div className={rest.className} style={{ background: "rgba(255,255,255,0.04)" }} />;
  }
  return <video src={resolved} {...rest} />;
}

type AudioProps = Omit<AudioHTMLAttributes<HTMLAudioElement>, "src"> & {
  url: string | null | undefined;
};

export function SignedAudio({ url, ...rest }: AudioProps) {
  const resolved = useSignedMessageUrl(url);
  if (!resolved) return null;
  return <audio src={resolved} {...rest} />;
}
