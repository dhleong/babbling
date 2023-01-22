import { machineId } from "node-machine-id";
import { v5 as uuid } from "uuid";

const NAMESPACE = "424e7f6a-3f0e-4817-a4c8-1a4b20702530";

export default async function generateMachineUuid() {
    return uuid(await machineId(), NAMESPACE);
}
