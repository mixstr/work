<?php
    require(dirname(__DIR__) . '/configDB.php');

    $sql = file_get_contents(dirname(__DIR__) . '/sql/selectCoefficient.sql');
    $query = $databasehandler->query($sql);

    foreach ($query as $row) {
        print "<br/>";
        print $row['id'] . '-' . $row['employee_id'] . '-' . $row['month_id'] . '-' . $row['coefficient'] . '<br/>';
    }
?>
