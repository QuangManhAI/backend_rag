import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import * as dotenv from 'dotenv';
dotenv.config({ path: '../.env' });

const s3 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT_URL,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  },
});

async function run() {
  const bucketName = process.env.R2_BUCKET_NAME || 'uth-scientific-lakehouse';

  // Check all manifests in R2
  const versionsRes = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: 'gold/lancedb/scientific_papers_gold.lance/_versions/',
    }),
  );
  console.log('R2 _versions keys:');
  for (const obj of versionsRes.Contents || []) {
    console.log(` - ${obj.Key} (${obj.LastModified})`);
  }

  // Check latest_version_hint in R2
  const hintRes = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: 'gold/lancedb/scientific_papers_gold.lance/_versions/latest_version_hint.json',
    }),
  );
  console.log('R2 latest_version_hint:', hintRes.Contents?.map((c) => c.Key));

  // Check data files count and total size in R2
  let dataCount = 0;
  let dataTotalBytes = 0;
  let continuationToken: string | undefined = undefined;
  do {
    const dataRes = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: 'gold/lancedb/scientific_papers_gold.lance/data/',
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of dataRes.Contents || []) {
      dataCount++;
      dataTotalBytes += obj.Size || 0;
    }
    continuationToken = dataRes.NextContinuationToken;
  } while (continuationToken);

  console.log(
    `Total data files in R2 under scientific_papers_gold.lance/data/: ${dataCount} files, ${(dataTotalBytes / 1024 / 1024 / 1024).toFixed(2)} GB`,
  );

  // Check if 010110100110010111101001fe0b7240e6bc5c88f60cdef7b8.lance exists in R2
  const singleFile = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: 'gold/lancedb/scientific_papers_gold.lance/data/010110100110010111101001fe0b7240e6bc5c88f60cdef7b8.lance',
    }),
  );
  console.log(
    'Does the 4.2GB 913k file exist in R2?',
    singleFile.Contents && singleFile.Contents.length > 0 ? 'YES' : 'NO',
  );
}

run().catch(console.error);
