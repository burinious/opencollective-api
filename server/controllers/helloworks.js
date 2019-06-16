import { get } from 'lodash';
import config from 'config';
import HelloWorks from 'helloworks-sdk';
import s3 from '../lib/awsS3';
import models from '../models';
import fs from 'fs';

const { User, LegalDocument, RequiredLegalDocument } = models;
const {
  requestStatus: { ERROR, RECEIVED },
} = LegalDocument;
const {
  documentType: { US_TAX_FORM },
} = RequiredLegalDocument;

const HELLO_WORKS_KEY = get(config, 'helloworks.key');
const HELLO_WORKS_SECRET = get(config, 'helloworks.secret');
const HELLO_WORKS_WORKFLOW_ID = get(config, 'helloworks.workflowId');

const HELLO_WORKS_S3_BUCKET = get(config, 'helloworks.aws.s3.bucket');

const client = new HelloWorks({
  apiKeyId: HELLO_WORKS_KEY,
  apiKeySecret: HELLO_WORKS_SECRET,
});

async function callback(req, res) {
  console.log(req.body);
  const {
    body: { status, workflow_id: workflowId, data, id, metadata },
  } = req;

  if (status && status === 'completed' && workflowId == HELLO_WORKS_WORKFLOW_ID) {
    const { userSlug, year } = metadata;
    const documentId = Object.keys(data)[0];
    console.log(`workflowId: ${workflowId}, documentId: ${documentId}`);

    const user = await User.findOne({
      where: {
        slug: userSlug,
      },
    });
    const doc = await LegalDocument.findByTypeYearUser({ year, documentType: US_TAX_FORM, user });

    client.workflowInstances
      .getInstanceDocument({
        instanceId: id,
        documentId,
      })
      .then(UploadToS3({ slug: userSlug, year, documentType: US_TAX_FORM }))
      .then(({ Location: location }) => {
        doc.requestStatus = RECEIVED;
        doc.documentLink = location;
        return doc.save();
      })
      .then(() => res.sendCode(200))
      .catch(err => {
        doc.requestStatus = ERROR;
        doc.save();
        console.log('error saving tax form: ', err);
        res.sendStatus(400);
      });
  } else {
    res.sendStatus(200);
  }
}

function UploadToS3({ slug, year, documentType }) {
  return function uploadToS3(buffer) {
    const bucket = HELLO_WORKS_S3_BUCKET;
    const key = createTaxFormFilename({ slug, year, documentType });

    if (!s3) {
      // s3 may not be set in a dev env
      console.error('s3 is not set, saving file to temp folder. This should only be done in development');
      saveFileToTempStorage({ filename: key, buffer });
      return Promise.resolve();
    }

    // TODO: encrypt the form here.

    return new Promise((resolve, reject) => {
      s3.upload({ Body: buffer, bucket, key }, (err, data) => {
        if (err) {
          console.log('error uploading file to s3: ', err);
          reject();
        } else {
          resolve(data);
        }
      });
    });
  };
}

function saveFileToTempStorage({ buffer, filename }) {
  fs.writeFile(`/tmp/${filename}`, buffer, console.log);
}

function createTaxFormFilename({ slug, year, documentType }) {
  return `${documentType}_${year}_${slug}.pdf`;
}

export default {
  callback,
};
