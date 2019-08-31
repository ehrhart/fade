/* eslint-disable no-console */
const debug = require('debug')('fade:permuter');
const Combinatorics = require('js-combinatorics');

function sperse(inputs, separator) {
  const output = [];

  const totalInputsCount = inputs.length + 1;

  for (let slotIndex = 0; slotIndex <= totalInputsCount; slotIndex += 1) {
    const slotsPos = [];
    let currentIndex = slotIndex - 1;
    const freeSlotsCount = totalInputsCount - slotIndex;

    // Set starting positions
    for (let i = 0; i < slotIndex; i += 1) {
      slotsPos[i] = i;
    }

    // Add starting position to output
    const arr = inputs.slice();
    for (let i = 0; i < slotsPos.length; i += 1) {
      arr.splice(slotsPos[i] + i, 0, separator);
    }
    output.push(arr.slice());

    // Check free slots
    for (let i = 0; i < slotIndex; i += 1) {
      for (let j = 0; j < freeSlotsCount; j += 1) {
        slotsPos[currentIndex] += 1;

        const arrSlot = inputs.slice();
        for (let k = 0; k < slotsPos.length; k += 1) {
          arrSlot.splice(slotsPos[k] + k, 0, separator);
        }
        output.push(arrSlot.slice());
      }

      currentIndex -= 1;
    }
  }

  return output;
}

module.exports = {
  permute: (primaryEntitiesList, secondaryEntitiesList, options) => {
    const opts = options || {};
    const prefixes = opts.prefixes || [];

    const shouldPermute =
      typeof opts.permute === 'undefined' ? true : opts.permute;

    debug(`Primary: ${primaryEntitiesList}`);
    debug(`Secondary: ${secondaryEntitiesList}`);

    // Add primary entities to the list of secondary entities
    primaryEntitiesList.forEach(ent => secondaryEntitiesList.push(ent));

    const primaryMapping = [];
    const entitiesMapping = [];
    let entitiesMappingLength = entitiesMapping.length;
    for (let i = 0; i < secondaryEntitiesList.length; i += 1) {
      const ent = secondaryEntitiesList[i];
      entitiesMapping.push(ent);
      secondaryEntitiesList[i] = `$${entitiesMappingLength}`;
      if (primaryEntitiesList.includes(ent)) {
        primaryMapping.push(`$${entitiesMappingLength}`);
      }
      entitiesMappingLength += 1;
    }

    let finalArray = [];

    // Combine secondary entities
    const combinedSecondaries = [];
    secondaryEntitiesList.forEach(secondary => {
      combinedSecondaries.push(secondary);
    });

    if (shouldPermute) {
      // Permute the entities
      const permComb = Combinatorics.permutationCombination(
        combinedSecondaries
      ).toArray();
      permComb.forEach(pc => {
        if (pc.some(v => primaryMapping.includes(v))) {
          // Intersperse them with @sys.any:any
          finalArray = finalArray.concat(sperse(pc, '@sys.any:any'));
        }
      });
    } else {
      // Do not permute, but still intersperse with @sys.any
      secondaryEntitiesList.forEach(sec => {
        finalArray = finalArray.concat(sperse([sec], '@sys.any:any'));
      });
    }

    /*
     * Remove duplicate elements
     *
     * Input:
     * @a @b @b @c
     *
     * Output:
     * @a @b @c
     */
    const finalArrayLength = finalArray.length;
    for (let i = 0; i < finalArrayLength; i += 1) {
      const item = finalArray[i];
      finalArray[i] = item.filter((entity, index) => {
        if (item[index + 1] === entity) {
          return false;
        }
        return true;
      });
    }

    /*
     * Flattens the mapping array
     *
     * Input:
     * [['@a', '@b', '@c'], ['@c','@b','@a']]
     *
     * Output:
     * ['@a @b @c', '@c @b @a']
     */
    finalArray = finalArray.map(item => item.join(' '));

    /*
     * Remove single '@sys.any:any'
     *
     * Input:
     * ['@foo:foo @sys.any:any', '@sys.any:any', '@bar:bar']
     *
     * Output:
     * ['@foo:foo @sys.any:any', '@bar:bar']
     */
    finalArray = finalArray.filter(item => item !== '@sys.any:any');

    /*
     * Map indexes to values
     *
     * Mapping:
     * ['@foo:foo', '@bar:bar']
     *
     * Input:
     * @1 @0
     *
     * Output:
     * @bar:bar @foo:foo
     */
    finalArray = finalArray.map(item => {
      entitiesMapping.forEach((value, index) => {
        item = item.replace(`$${index}`, value);
      });
      return item;
    });

    /*
     * Remove duplicates
     *
     * Input:
     * @a @b @c
     * @c @b @a
     * @a @b @c
     *
     * Output:
     * @a @b @c
     * @c @b @a
     */
    finalArray = Object.keys(
      finalArray.reduce((accumulator, currentValue) => {
        accumulator[currentValue] = true;
        return accumulator;
      }, {})
    );

    /*
     * Add prefixes
     *
     * Prefixes:
     * ['foo', 'bar']
     *
     * Input:
     * @a @b @c
     *
     * Output:
     * foo @a @b @c
     * bar @a @b @c
     */
    const prefixedArray = prefixes.length === 0 ? finalArray.slice(0) : [];
    const faLen = finalArray.length;
    prefixes.forEach(prefix => {
      for (let i = 0; i < faLen; i += 1) {
        const item = finalArray[i];
        // Add prefixed version of the entity
        prefixedArray.push(`${prefix} ${item}`);
        // If the item is a primary entity, add it without prefix as well
        if (primaryEntitiesList.indexOf(item) > -1 && !options.prefixesOnly) {
          prefixedArray.push(item);
        }
      }
    });
    finalArray = prefixedArray.slice(0);

    return finalArray;
  }
};
