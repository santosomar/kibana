/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { AlertsClient, ConstructorOptions } from '../alerts_client';
import { savedObjectsClientMock, loggingSystemMock } from '../../../../../../src/core/server/mocks';
import { taskManagerMock } from '../../../../task_manager/server/mocks';
import { alertTypeRegistryMock } from '../../alert_type_registry.mock';
import { alertsAuthorizationMock } from '../../authorization/alerts_authorization.mock';
import { encryptedSavedObjectsMock } from '../../../../encrypted_saved_objects/server/mocks';
import { actionsAuthorizationMock } from '../../../../actions/server/mocks';
import { AlertsAuthorization } from '../../authorization/alerts_authorization';
import { ActionsAuthorization } from '../../../../actions/server';
import { httpServerMock } from '../../../../../../src/core/server/mocks';
import { auditServiceMock } from '../../../../security/server/audit/index.mock';
import { getBeforeSetup, setGlobalDate } from './lib';

const taskManager = taskManagerMock.createStart();
const alertTypeRegistry = alertTypeRegistryMock.create();
const unsecuredSavedObjectsClient = savedObjectsClientMock.create();
const encryptedSavedObjects = encryptedSavedObjectsMock.createClient();
const authorization = alertsAuthorizationMock.create();
const actionsAuthorization = actionsAuthorizationMock.create();
const auditLogger = auditServiceMock.create().asScoped(httpServerMock.createKibanaRequest());

const kibanaVersion = 'v7.10.0';
const alertsClientParams: jest.Mocked<ConstructorOptions> = {
  taskManager,
  alertTypeRegistry,
  unsecuredSavedObjectsClient,
  authorization: (authorization as unknown) as AlertsAuthorization,
  actionsAuthorization: (actionsAuthorization as unknown) as ActionsAuthorization,
  spaceId: 'default',
  namespace: 'default',
  getUserName: jest.fn(),
  createAPIKey: jest.fn(),
  logger: loggingSystemMock.create().get(),
  encryptedSavedObjectsClient: encryptedSavedObjects,
  getActionsClient: jest.fn(),
  getEventLogClient: jest.fn(),
  kibanaVersion,
};

beforeEach(() => {
  getBeforeSetup(alertsClientParams, taskManager, alertTypeRegistry);
  (auditLogger.log as jest.Mock).mockClear();
});

setGlobalDate();

describe('unmuteAll()', () => {
  test('unmutes an alert', async () => {
    const alertsClient = new AlertsClient(alertsClientParams);
    unsecuredSavedObjectsClient.get.mockResolvedValueOnce({
      id: '1',
      type: 'alert',
      attributes: {
        actions: [
          {
            group: 'default',
            id: '1',
            actionTypeId: '1',
            actionRef: '1',
            params: {
              foo: true,
            },
          },
        ],
        muteAll: true,
      },
      references: [],
      version: '123',
    });

    await alertsClient.unmuteAll({ id: '1' });
    expect(unsecuredSavedObjectsClient.update).toHaveBeenCalledWith(
      'alert',
      '1',
      {
        muteAll: false,
        mutedInstanceIds: [],
        updatedAt: '2019-02-12T21:01:22.479Z',
        updatedBy: 'elastic',
      },
      {
        version: '123',
      }
    );
  });

  describe('authorization', () => {
    beforeEach(() => {
      unsecuredSavedObjectsClient.get.mockResolvedValueOnce({
        id: '1',
        type: 'alert',
        attributes: {
          actions: [
            {
              group: 'default',
              id: '1',
              actionTypeId: '1',
              actionRef: '1',
              params: {
                foo: true,
              },
            },
          ],
          consumer: 'myApp',
          schedule: { interval: '10s' },
          alertTypeId: 'myType',
          apiKey: null,
          apiKeyOwner: null,
          enabled: false,
          scheduledTaskId: null,
          updatedBy: 'elastic',
          muteAll: false,
        },
        references: [],
      });
    });

    test('ensures user is authorised to unmuteAll this type of alert under the consumer', async () => {
      const alertsClient = new AlertsClient(alertsClientParams);
      await alertsClient.unmuteAll({ id: '1' });

      expect(authorization.ensureAuthorized).toHaveBeenCalledWith('myType', 'myApp', 'unmuteAll');
      expect(actionsAuthorization.ensureAuthorized).toHaveBeenCalledWith('execute');
    });

    test('throws when user is not authorised to unmuteAll this type of alert', async () => {
      const alertsClient = new AlertsClient(alertsClientParams);
      authorization.ensureAuthorized.mockRejectedValue(
        new Error(`Unauthorized to unmuteAll a "myType" alert for "myApp"`)
      );

      await expect(alertsClient.unmuteAll({ id: '1' })).rejects.toMatchInlineSnapshot(
        `[Error: Unauthorized to unmuteAll a "myType" alert for "myApp"]`
      );

      expect(authorization.ensureAuthorized).toHaveBeenCalledWith('myType', 'myApp', 'unmuteAll');
    });
  });

  describe('auditLogger', () => {
    test('logs audit event when unmuting an alert', async () => {
      const alertsClient = new AlertsClient({ ...alertsClientParams, auditLogger });
      unsecuredSavedObjectsClient.get.mockResolvedValueOnce({
        id: '1',
        type: 'alert',
        attributes: {
          actions: [
            {
              group: 'default',
              id: '1',
              actionTypeId: '1',
              actionRef: '1',
              params: {
                foo: true,
              },
            },
          ],
          muteAll: false,
        },
        references: [],
        version: '123',
      });
      await alertsClient.unmuteAll({ id: '1' });
      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({
            action: 'alert_unmute',
            outcome: 'unknown',
          }),
          kibana: { saved_object: { id: '1', type: 'alert' } },
        })
      );
    });

    test('logs audit event when not authorised to unmute an alert', async () => {
      const alertsClient = new AlertsClient({ ...alertsClientParams, auditLogger });
      unsecuredSavedObjectsClient.get.mockResolvedValueOnce({
        id: '1',
        type: 'alert',
        attributes: {
          actions: [
            {
              group: 'default',
              id: '1',
              actionTypeId: '1',
              actionRef: '1',
              params: {
                foo: true,
              },
            },
          ],
          muteAll: false,
        },
        references: [],
        version: '123',
      });
      authorization.ensureAuthorized.mockRejectedValue(new Error('Unauthorized'));

      await expect(alertsClient.unmuteAll({ id: '1' })).rejects.toThrow();
      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({
            action: 'alert_unmute',
            outcome: 'failure',
          }),
          kibana: {
            saved_object: {
              id: '1',
              type: 'alert',
            },
          },
          error: {
            code: 'Error',
            message: 'Unauthorized',
          },
        })
      );
    });
  });
});
