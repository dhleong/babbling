export default function getPackageVersion() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("../../package.json").version;
}
