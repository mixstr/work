<?php
    #set XML in Postman to view result of code
    global $databasehandler;
    require_once(__DIR__ . '/../configDB.php');

    $sql = file_get_contents(__DIR__ . '/../sql/selectmonth.sql');
    foreach ($databasehandler->query($sql) as $row) {
        print "<br/>";
        print $row['id'] . '-' . $row['name'] . '-' . $row['day'] . '-' . $row['month'] . $row['year'] . '<br/>';
    }
    ?>

