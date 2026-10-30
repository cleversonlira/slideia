/* S3-compatible blob store (remote mode only: kept apart so the local bundle needs no AWS SDK). */
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { BlobStore } from "./blobs.js";

export interface S3Options {
  bucket: string;
  region?: string | undefined;
  endpoint?: string | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  /** Path-style URLs (MinIO, some providers). */
  forcePathStyle?: boolean | undefined;
  prefix?: string | undefined;
  /** Create the bucket on startup if it does not exist. */
  createBucket?: boolean | undefined;
}

export class S3BlobStore implements BlobStore {
  private readonly client: S3Client;

  constructor(private readonly opts: S3Options) {
    this.client = new S3Client({
      region: opts.region ?? "auto",
      ...(opts.endpoint ? { endpoint: opts.endpoint } : {}),
      forcePathStyle: opts.forcePathStyle ?? false,
      ...(opts.accessKeyId && opts.secretAccessKey
        ? { credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } }
        : {}),
    });
  }

  /** Creates the bucket when missing (local simulation; production buckets are provisioned). */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.opts.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.opts.bucket }));
    }
  }

  private key(k: string): string {
    return `${this.opts.prefix ?? ""}${k}`;
  }

  async put(key: string, data: Uint8Array, mime: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: this.key(key),
        Body: data,
        ContentType: mime,
      }),
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.opts.bucket, Key: this.key(key) }),
      );
      return res.Body ? await res.Body.transformToByteArray() : null;
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: this.key(key) }),
    );
  }
}
