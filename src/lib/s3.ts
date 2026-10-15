import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

export const S3_BUCKET = process.env.S3_BUCKET ?? "dopa-media";

const credentials = {
  accessKeyId: process.env.S3_ACCESS_KEY ?? "",
  secretAccessKey: process.env.S3_SECRET_KEY ?? "",
};

const globalForS3 = globalThis as unknown as {
  __dopaS3Internal?: S3Client;
  __dopaS3Public?: S3Client;
};

function s3Internal(): S3Client {
  if (!globalForS3.__dopaS3Internal) {
    globalForS3.__dopaS3Internal = new S3Client({
      region: process.env.S3_REGION ?? "garage",
      endpoint: process.env.S3_ENDPOINT ?? "http://garage:3900",
      forcePathStyle: true,
      credentials,
    });
  }
  return globalForS3.__dopaS3Internal;
}

function s3Public(): S3Client {
  if (!globalForS3.__dopaS3Public) {
    globalForS3.__dopaS3Public = new S3Client({
      region: process.env.S3_REGION ?? "garage",
      endpoint:
        process.env.S3_PUBLIC_ENDPOINT ??
        (process.env.NODE_ENV === "production"
          ? "https://media.dopa-radio.sosukeiwasaki.f5.si"
          : (process.env.S3_ENDPOINT ?? "http://localhost:3900")),
      forcePathStyle: true,
      credentials,
    });
  }
  return globalForS3.__dopaS3Public;
}

export async function presignPut(
  key: string,
  contentType: string,
  expiresInSeconds = 3600,
): Promise<string> {
  return getSignedUrl(
    s3Public(),
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: expiresInSeconds },
  );
}

export async function presignGet(key: string, expiresInSeconds = 21600): Promise<string> {
  return getSignedUrl(s3Public(), new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), {
    expiresIn: expiresInSeconds,
  });
}

export async function headObject(key: string): Promise<boolean> {
  try {
    await s3Internal().send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function getObjectToFile(key: string, filePath: string): Promise<void> {
  const res = await s3Internal().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  await pipeline(res.Body as Readable, createWriteStream(filePath));
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await s3Internal().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as Readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function putObjectBuffer(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3Internal().send(
    new PutObjectCommand({ Bucket: S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function putObjectFile(
  key: string,
  filePath: string,
  contentType: string,
): Promise<void> {
  await s3Internal().send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: createReadStream(filePath),
      ContentType: contentType,
    }),
  );
}

export async function deleteObject(key: string): Promise<void> {
  await s3Internal().send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

export async function deletePrefix(prefix: string): Promise<void> {
  let token: string | undefined;
  do {
    const res = await s3Internal().send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const item of res.Contents ?? []) {
      if (item.Key) await deleteObject(item.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
}
